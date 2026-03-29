import path from "node:path";
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { describe, expect, test, beforeEach, afterAll, vi } from "vitest";

const {
  mediaRootPath,
  execFileAsyncMock,
  claimNextBackupJobMock,
  completeJobMock,
  failJobMock,
} = vi.hoisted(() => ({
  mediaRootPath: `/tmp/localtrade-worker-tests-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  execFileAsyncMock: vi.fn(),
  claimNextBackupJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
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
  mediaRepository: {},
}));

vi.mock("../src/db/pool.js", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("sharp", () => ({
  default: vi.fn(),
}));

import { processBackupJobs } from "../src/jobs/worker.js";

describe("backup worker jobs", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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
});
