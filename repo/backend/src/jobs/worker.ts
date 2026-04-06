import { pool } from "../db/pool.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import { MAX_JOB_RETRIES, JOB_RETRY_DELAY_MS } from "../domain.js";
import { adminRepository } from "../repositories/admin-repository.js";
import { mediaRepository } from "../repositories/media-repository.js";
import { fileStorage } from "../storage/file-storage.js";

const execFileAsync = promisify(execFile);
const BACKUP_RETENTION_DAYS = 30;
const NIGHTLY_BACKUP_MS = 24 * 60 * 60 * 1000;
const STALE_RECOVERY_MS = 5 * 60 * 1000;

let assetWorkerTimer: NodeJS.Timeout | null = null;
let staleRecoveryTimer: NodeJS.Timeout | null = null;
let nightlyBackupTimer: NodeJS.Timeout | null = null;
let assetWorkerRunning = false;
let staleRecoveryRunning = false;

function encryptBuffer(value: Buffer) {
  const iv = randomBytes(12);
  const key = Buffer.from(config.encryptionKeyHex, "hex").subarray(0, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export async function recoverStaleJobs() {
  await pool.query(
    `UPDATE jobs
     SET status = CASE WHEN retry_count + 1 >= $1 THEN 'failed' ELSE 'queued' END,
         retry_count = retry_count + 1,
         locked_at = NULL,
         updated_at = NOW()
     WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes'`,
    [MAX_JOB_RETRIES],
  );
}

async function extractMetadata(storagePath: string, extension: string) {
  const ext = extension.toLowerCase();
  if (ext === "jpg" || ext === "png") {
    const meta = await sharp(storagePath).metadata();
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
    };
  }
  if (ext === "mp4") {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      storagePath,
    ]);
    const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> };
    const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
    return {
      durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
      codec: videoStream?.codec_name ?? null,
    };
  }
  return {};
}

async function optimizeAsset(storagePath: string, extension: string) {
  const ext = extension.toLowerCase();
  const before = (await stat(storagePath)).size;

  if (ext === "jpg") {
    const optimized = await sharp(storagePath)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (optimized.length < before) {
      await writeFile(storagePath, optimized);
      return { optimizationMode: "image_compression", originalBytes: before, optimizedBytes: optimized.length };
    }
    return { optimizationMode: "image_compression", originalBytes: before, optimizedBytes: before };
  }

  if (ext === "png") {
    const optimized = await sharp(storagePath)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    if (optimized.length < before) {
      await writeFile(storagePath, optimized);
      return { optimizationMode: "image_compression", originalBytes: before, optimizedBytes: optimized.length };
    }
    return { optimizationMode: "image_compression", originalBytes: before, optimizedBytes: before };
  }

  if (ext === "mp4") {
    const tempPath = `${storagePath}.optimized.mp4`;
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        storagePath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        tempPath,
      ]);
      const after = (await stat(tempPath)).size;
      if (after < before) {
        await rename(tempPath, storagePath);
        return { optimizationMode: "video_transcode", originalBytes: before, optimizedBytes: after };
      }
      await unlink(tempPath);
      return { optimizationMode: "video_transcode", originalBytes: before, optimizedBytes: before };
    } catch {
      await unlink(tempPath).catch(() => undefined);
      return { optimizationMode: "video_transcode_skipped", originalBytes: before, optimizedBytes: before };
    }
  }

  return { optimizationMode: "none", originalBytes: before, optimizedBytes: before };
}

export async function processAssetPostprocessJobs(limit = 20) {
  for (let i = 0; i < limit; i += 1) {
    const job = await mediaRepository.claimNextAssetPostprocessJob();
    if (!job) return;
    try {
      const assetId = String(job.payload_json.assetId ?? "");
      if (!assetId) {
        throw new Error("assetId missing in job payload");
      }
      const asset = await mediaRepository.findAssetById(assetId);
      if (!asset || !asset.storage_path) {
        throw new Error("asset not found for postprocess");
      }
      const storagePath = String(asset.storage_path);
      const extension = String(asset.extension);
      let optimization: Record<string, unknown> = {};
      try {
        optimization = await optimizeAsset(storagePath, extension);
      } catch {
        const size = (await stat(storagePath)).size;
        optimization = {
          optimizationMode: "postprocess_skipped",
          originalBytes: size,
          optimizedBytes: size,
        };
      }

      let metadata: Record<string, unknown> = {};
      try {
        metadata = await extractMetadata(storagePath, extension);
      } catch {
        metadata = {};
      }

      await mediaRepository.markAssetReady(assetId, { ...metadata, ...optimization });
      await mediaRepository.completeJob(job.id);
    } catch (error) {
      const assetId = String(job.payload_json.assetId ?? "");
      const errorMsg = error instanceof Error ? error.message : "asset postprocess failed";
      const nextAttempt = job.retry_count + 1;
      if (nextAttempt < MAX_JOB_RETRIES) {
        await mediaRepository.requeueJob(job.id, errorMsg, JOB_RETRY_DELAY_MS);
      } else {
        if (assetId) {
          await mediaRepository.markAssetFailed(assetId);
        }
        await mediaRepository.failJob(job.id, errorMsg);
      }
    }
  }
}

async function runAssetWorkerTick() {
  if (assetWorkerRunning) return;
  assetWorkerRunning = true;
  try {
    await processAssetPostprocessJobs(20);
  } finally {
    assetWorkerRunning = false;
  }
}

export function signalAssetWorker() {
  void runAssetWorkerTick();
}

export function startAssetPostprocessScheduler() {
  if (assetWorkerTimer) return;
  void runAssetWorkerTick();
  assetWorkerTimer = setInterval(() => {
    void runAssetWorkerTick();
  }, Math.max(25, config.assetWorkerPollMs));
  assetWorkerTimer.unref?.();
}

export const STALE_BUYER_ASSET_AGE_MS = 24 * 60 * 60 * 1000;

export async function cleanupStaleBuyerAssets() {
  const stale = await mediaRepository.deleteStaleUnattachedBuyerAssets(STALE_BUYER_ASSET_AGE_MS);
  for (const asset of stale) {
    if (asset.storage_path) {
      await fileStorage.removeFile(asset.storage_path);
    }
  }
  return stale.length;
}

async function runStaleRecoveryTick() {
  if (staleRecoveryRunning) return;
  staleRecoveryRunning = true;
  try {
    await recoverStaleJobs();
    await cleanupStaleBuyerAssets();
  } finally {
    staleRecoveryRunning = false;
  }
}

export function startStaleRecoveryScheduler() {
  if (staleRecoveryTimer) return;
  void runStaleRecoveryTick();
  staleRecoveryTimer = setInterval(() => {
    void runStaleRecoveryTick();
  }, STALE_RECOVERY_MS);
  staleRecoveryTimer.unref?.();
}

async function createEncryptedBackupFile() {
  const backupDir = path.join(config.mediaRootPath, "backups");
  await mkdir(backupDir, { recursive: true });
  const { stdout } = await execFileAsync("pg_dump", ["--dbname", config.databaseUrl, "--no-owner", "--no-privileges"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const encrypted = encryptBuffer(Buffer.from(stdout));
  const date = new Date();
  const fileName = `backup-${date.toISOString().slice(0, 10)}-${date.getTime()}.sql.enc`;
  const filePath = path.join(backupDir, fileName);
  await writeFile(filePath, encrypted);
  return filePath;
}

async function pruneOldBackups() {
  const backupDir = path.join(config.mediaRootPath, "backups");
  await mkdir(backupDir, { recursive: true });
  const files = await readdir(backupDir);
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    if (!file.endsWith(".sql.enc")) continue;
    const filePath = path.join(backupDir, file);
    const details = await stat(filePath);
    if (details.mtimeMs < cutoff) {
      await unlink(filePath);
    }
  }
}

export async function processBackupJobs(limit = 5) {
  for (let i = 0; i < limit; i += 1) {
    const job = await adminRepository.claimNextBackupJob();
    if (!job) return;
    try {
      await createEncryptedBackupFile();
      await pruneOldBackups();
      await adminRepository.completeJob(job.id);
    } catch (error) {
      await adminRepository.failJob(job.id, error instanceof Error ? error.message : "backup failed");
    }
  }
}

export function startNightlyBackupScheduler() {
  if (nightlyBackupTimer) return;

  const run = async () => {
    try {
      await adminRepository.createBackupJob();
      await processBackupJobs(1);
    } catch {
      // keep scheduler resilient; failures are persisted in job status
    }
  };

  void run();
  nightlyBackupTimer = setInterval(() => {
    void run();
  }, NIGHTLY_BACKUP_MS);
  nightlyBackupTimer.unref?.();
}

export function stopWorkerSchedulers() {
  if (assetWorkerTimer) {
    clearInterval(assetWorkerTimer);
    assetWorkerTimer = null;
  }
  if (staleRecoveryTimer) {
    clearInterval(staleRecoveryTimer);
    staleRecoveryTimer = null;
  }
  if (nightlyBackupTimer) {
    clearInterval(nightlyBackupTimer);
    nightlyBackupTimer = null;
  }
}
