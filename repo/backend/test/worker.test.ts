import path from "node:path";
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { describe, expect, test, beforeEach, afterAll, vi } from "vitest";

const {
  mediaRootPath,
  execFileAsyncMock,
  claimNextBackupJobMock,
  completeJobMock,
  failJobMock,
  poolQueryMock,
  claimNextAssetPostprocessJobMock,
  completeAssetJobMock,
  failAssetJobMock,
  requeueJobMock,
  findAssetByIdMock,
  markAssetReadyMock,
  markAssetFailedMock,
  deleteStaleUnattachedBuyerAssetsMock,
  removeFileMock,
} = vi.hoisted(() => ({
  mediaRootPath: `/tmp/localtrade-worker-tests-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  execFileAsyncMock: vi.fn(),
  claimNextBackupJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  poolQueryMock: vi.fn(),
  claimNextAssetPostprocessJobMock: vi.fn(),
  completeAssetJobMock: vi.fn(),
  failAssetJobMock: vi.fn(),
  requeueJobMock: vi.fn(),
  findAssetByIdMock: vi.fn(),
  markAssetReadyMock: vi.fn(),
  markAssetFailedMock: vi.fn(),
  deleteStaleUnattachedBuyerAssetsMock: vi.fn(),
  removeFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn(() => execFileAsyncMock),
}));

vi.mock("../src/config.js", () => ({
  config: {
    mediaRootPath,
    databaseUrl: "postgres://localtrade:localtrade@localhost:5432/localtrade",
    encryptionKeyHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

vi.mock("../src/repositories/admin-repository.js", () => ({
  adminRepository: {
    claimNextBackupJob: claimNextBackupJobMock,
    completeJob: completeJobMock,
    failJob: failJobMock,
    createBackupJob: vi.fn(),
  },
}));

vi.mock("../src/repositories/media-repository.js", () => ({
  mediaRepository: {
    claimNextAssetPostprocessJob: claimNextAssetPostprocessJobMock,
    completeJob: completeAssetJobMock,
    failJob: failAssetJobMock,
    requeueJob: requeueJobMock,
    findAssetById: findAssetByIdMock,
    markAssetReady: markAssetReadyMock,
    markAssetFailed: markAssetFailedMock,
    deleteStaleUnattachedBuyerAssets: deleteStaleUnattachedBuyerAssetsMock,
  },
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: poolQueryMock,
  },
}));

vi.mock("../src/storage/file-storage.js", () => ({
  fileStorage: {
    removeFile: removeFileMock,
  },
}));

vi.mock("sharp", () => {
  const sharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 200 }),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(50)),
  };
  return { default: vi.fn(() => sharpInstance) };
});

import { processBackupJobs, processAssetPostprocessJobs, recoverStaleJobs, startStaleRecoveryScheduler, stopWorkerSchedulers, cleanupStaleBuyerAssets } from "../src/jobs/worker.js";
import { MAX_JOB_RETRIES } from "../src/domain.js";
import { stat, writeFile as fsWriteFile } from "node:fs/promises";

describe("backup worker jobs", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useRealTimers();
    execFileAsyncMock.mockResolvedValue({ stdout: "-- mock dump --", stderr: "" });
    await rm(mediaRootPath, { recursive: true, force: true });
    await mkdir(path.join(mediaRootPath, "backups"), { recursive: true });
  });

  afterAll(async () => {
    await rm(mediaRootPath, { recursive: true, force: true });
  });

  test("creates encrypted backup, prunes stale files, and completes job", async () => {
    const backupDir = path.join(mediaRootPath, "backups");
    const oldFile = path.join(backupDir, "old-backup.sql.enc");
    const recentFile = path.join(backupDir, "recent-backup.sql.enc");
    const ignoredFile = path.join(backupDir, "readme.txt");

    await writeFile(oldFile, "old");
    await writeFile(recentFile, "recent");
    await writeFile(ignoredFile, "keep");
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, oldDate, oldDate);

    claimNextBackupJobMock.mockResolvedValueOnce({ id: "job-backup-1" }).mockResolvedValueOnce(null);

    await processBackupJobs(5);

    const files = await readdir(backupDir);
    expect(files).not.toContain("old-backup.sql.enc");
    expect(files).toContain("recent-backup.sql.enc");
    expect(files).toContain("readme.txt");
    expect(files.some((name) => name.startsWith("backup-") && name.endsWith(".sql.enc"))).toBe(true);

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "pg_dump",
      ["--dbname", "postgres://localtrade:localtrade@localhost:5432/localtrade", "--no-owner", "--no-privileges"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(completeJobMock).toHaveBeenCalledWith("job-backup-1");
    expect(failJobMock).not.toHaveBeenCalled();
  });

  test("marks job failed when backup generation throws", async () => {
    execFileAsyncMock.mockRejectedValueOnce(new Error("pg_dump failed"));
    claimNextBackupJobMock.mockResolvedValueOnce({ id: "job-backup-2" }).mockResolvedValueOnce(null);

    await processBackupJobs(5);

    expect(completeJobMock).not.toHaveBeenCalled();
    expect(failJobMock).toHaveBeenCalledWith("job-backup-2", "pg_dump failed");
  });

  test("stale-job recovery scheduler runs immediately and every 5 minutes", async () => {
    vi.useFakeTimers();
    poolQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    deleteStaleUnattachedBuyerAssetsMock.mockResolvedValue([]);

    startStaleRecoveryScheduler();
    await vi.runOnlyPendingTimersAsync();

    expect(poolQueryMock).toHaveBeenCalled();
    const initialCalls = poolQueryMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(poolQueryMock.mock.calls.length).toBeGreaterThan(initialCalls);

    stopWorkerSchedulers();
    vi.useRealTimers();
  });
});

describe("asset postprocess retry lifecycle", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useRealTimers();
    await rm(mediaRootPath, { recursive: true, force: true });
    await mkdir(mediaRootPath, { recursive: true });
  });

  afterAll(async () => {
    await rm(mediaRootPath, { recursive: true, force: true });
  });

  test("transient failure requeues job with incremented retry_count (attempt 1 of 3)", async () => {
    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-1",
      payload_json: { assetId: "asset-1" },
      retry_count: 0,
    });

    findAssetByIdMock.mockResolvedValueOnce(null);

    await processAssetPostprocessJobs(1);

    expect(requeueJobMock).toHaveBeenCalledTimes(1);
    expect(requeueJobMock).toHaveBeenCalledWith("job-1", "asset not found for postprocess", 5000);
    expect(failAssetJobMock).not.toHaveBeenCalled();
    expect(markAssetFailedMock).not.toHaveBeenCalled();
  });

  test("transient failure on retry_count=1 requeues again (attempt 2 of 3)", async () => {
    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-2",
      payload_json: { assetId: "asset-2" },
      retry_count: 1,
    });

    findAssetByIdMock.mockResolvedValueOnce(null);

    await processAssetPostprocessJobs(1);

    expect(requeueJobMock).toHaveBeenCalledTimes(1);
    expect(requeueJobMock).toHaveBeenCalledWith("job-2", "asset not found for postprocess", 5000);
    expect(failAssetJobMock).not.toHaveBeenCalled();
    expect(markAssetFailedMock).not.toHaveBeenCalled();
  });

  test("failure at max retries (retry_count=2) permanently fails the job and asset", async () => {
    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-3",
      payload_json: { assetId: "asset-3" },
      retry_count: 2,
    });

    findAssetByIdMock.mockResolvedValueOnce(null);

    await processAssetPostprocessJobs(1);

    expect(requeueJobMock).not.toHaveBeenCalled();
    expect(markAssetFailedMock).toHaveBeenCalledWith("asset-3");
    expect(failAssetJobMock).toHaveBeenCalledWith("job-3", "asset not found for postprocess");
  });

  test("successful processing after prior retries completes normally", async () => {
    const assetPath = path.join(mediaRootPath, "retry-success.jpg");
    await fsWriteFile(assetPath, Buffer.alloc(200));

    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-4",
      payload_json: { assetId: "asset-4" },
      retry_count: 1,
    });

    findAssetByIdMock.mockResolvedValueOnce({
      id: "asset-4",
      storage_path: assetPath,
      extension: "jpg",
    });

    await processAssetPostprocessJobs(1);

    expect(markAssetReadyMock).toHaveBeenCalledWith("asset-4", expect.any(Object));
    expect(completeAssetJobMock).toHaveBeenCalledWith("job-4");
    expect(requeueJobMock).not.toHaveBeenCalled();
    expect(failAssetJobMock).not.toHaveBeenCalled();
  });

  test("error message is preserved in requeued job", async () => {
    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-5",
      payload_json: { assetId: "asset-5" },
      retry_count: 0,
    });

    findAssetByIdMock.mockResolvedValueOnce(null);

    await processAssetPostprocessJobs(1);

    expect(requeueJobMock).toHaveBeenCalledWith(
      "job-5",
      "asset not found for postprocess",
      5000,
    );
  });

  test("error message is preserved in permanently failed job", async () => {
    claimNextAssetPostprocessJobMock.mockResolvedValueOnce({
      id: "job-6",
      payload_json: { assetId: "asset-6" },
      retry_count: 2,
    });

    findAssetByIdMock.mockResolvedValueOnce(null);

    await processAssetPostprocessJobs(1);

    expect(failAssetJobMock).toHaveBeenCalledWith(
      "job-6",
      "asset not found for postprocess",
    );
  });
});

describe("stale job recovery uses shared constant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("recoverStaleJobs passes MAX_JOB_RETRIES as SQL parameter", async () => {
    poolQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await recoverStaleJobs();

    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    const call = poolQueryMock.mock.calls[0];
    expect(call[1]).toEqual([MAX_JOB_RETRIES]);
    expect(call[0]).toContain("retry_count + 1 >= $1");
  });
});

describe("stale buyer asset cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("removes stale unattached buyer assets and their storage files", async () => {
    deleteStaleUnattachedBuyerAssetsMock.mockResolvedValueOnce([
      { id: "stale-1", storage_path: "/var/media/stale1.jpg" },
      { id: "stale-2", storage_path: "/var/media/stale2.png" },
    ]);
    removeFileMock.mockResolvedValue(undefined);

    const count = await cleanupStaleBuyerAssets();

    expect(count).toBe(2);
    expect(deleteStaleUnattachedBuyerAssetsMock).toHaveBeenCalledWith(24 * 60 * 60 * 1000);
    expect(removeFileMock).toHaveBeenCalledTimes(2);
    expect(removeFileMock).toHaveBeenCalledWith("/var/media/stale1.jpg");
    expect(removeFileMock).toHaveBeenCalledWith("/var/media/stale2.png");
  });

  test("skips file removal for assets with null storage_path", async () => {
    deleteStaleUnattachedBuyerAssetsMock.mockResolvedValueOnce([
      { id: "stale-3", storage_path: null },
    ]);

    const count = await cleanupStaleBuyerAssets();

    expect(count).toBe(1);
    expect(removeFileMock).not.toHaveBeenCalled();
  });

  test("returns 0 when no stale assets exist", async () => {
    deleteStaleUnattachedBuyerAssetsMock.mockResolvedValueOnce([]);

    const count = await cleanupStaleBuyerAssets();

    expect(count).toBe(0);
    expect(removeFileMock).not.toHaveBeenCalled();
  });
});
