import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

export const fileStorage = {
  async ensureRoots() {
    await mkdir(config.mediaRootPath, { recursive: true });
    await mkdir(config.chunkRootPath, { recursive: true });
  },

  chunkPath(sessionId: string, chunkIndex: number) {
    return join(config.chunkRootPath, `${sessionId}_${chunkIndex}.chunk`);
  },

  assetPath(assetId: string, extension: string) {
    return join(config.mediaRootPath, `${assetId}.${extension}`);
  },

  async writeChunk(path: string, content: Buffer) {
    await writeFile(path, content);
  },

  async readChunk(path: string) {
    return readFile(path);
  },

  async writeAsset(path: string, content: Buffer) {
    await writeFile(path, content);
  },

  async fingerprint(path: string) {
    const file = await readFile(path);
    return createHash("sha256").update(file).digest("hex");
  },

  async fileMetadata(path: string) {
    const s = await stat(path);
    return { bytes: s.size };
  },

  async removeFile(path: string) {
    await rm(path, { force: true });
  },
};
