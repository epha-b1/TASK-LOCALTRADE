import { config } from "../config.js";
import { ALLOWED_EXTENSIONS, CHUNK_SIZE, MAX_FILES_PER_LISTING, MAX_FILE_SIZE, MAX_REVIEW_IMAGES } from "../domain.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { listingRepository } from "../repositories/listing-repository.js";
import { mediaRepository } from "../repositories/media-repository.js";
import { hmacSha256 } from "../security/hmac.js";
import { fileStorage } from "../storage/file-storage.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";
import { signalAssetWorker } from "../jobs/worker.js";

const mimeByExt: Record<string, string> = { jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", pdf: "application/pdf" };
const reviewImageMimeByExt: Record<string, string> = { jpg: "image/jpeg", png: "image/png" };

function sniffMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  return null;
}

export const mediaService = {
  async createUploadSession(input: {
    listingId: string;
    sellerId: string;
    fileName: string;
    sizeBytes: number;
    extension: string;
    mimeType: string;
    totalChunks: number;
    chunkSizeBytes: number;
  }, actor: AuthUser) {
    const ext = input.extension.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) throw new HttpError(400, "INVALID_FILE_TYPE", "Unsupported file type");
    if (input.sizeBytes > MAX_FILE_SIZE) throw new HttpError(400, "FILE_TOO_LARGE", "File exceeds size limit");
    if (input.chunkSizeBytes !== CHUNK_SIZE) throw new HttpError(400, "INVALID_CHUNK_SIZE", "Chunk size must be 5MB");

    const listing = await listingRepository.findById(input.listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    const isOwnerSeller = actor.roles.includes("seller") && listing.seller_id === input.sellerId;
    const isEligibleBuyer = actor.roles.includes("buyer") && (await mediaRepository.buyerHasCompletedOrderForListing({ buyerId: actor.id, listingId: input.listingId }));
    if (!isOwnerSeller && !isEligibleBuyer) throw new HttpError(403, "FORBIDDEN", "Forbidden");

    if (!isOwnerSeller && isEligibleBuyer) {
      const expectedReviewMime = reviewImageMimeByExt[ext];
      if (!expectedReviewMime || input.mimeType.toLowerCase() !== expectedReviewMime) {
        throw new HttpError(400, "INVALID_REVIEW_IMAGE_TYPE", "Review attachments must be JPG or PNG images");
      }
      const pendingCount = await mediaRepository.countBuyerPendingAssetsForListing(actor.id, input.listingId);
      if (pendingCount >= MAX_REVIEW_IMAGES) {
        throw new HttpError(409, "BUYER_UPLOAD_QUOTA_EXCEEDED", `Buyer may have at most ${MAX_REVIEW_IMAGES} pending review images per listing`);
      }
    }

    if (isOwnerSeller) {
      const count = await mediaRepository.countAssetsForListing(input.listingId);
      if (count >= MAX_FILES_PER_LISTING) throw new HttpError(409, "FILE_LIMIT_REACHED", "File count limit reached");
    }

    await fileStorage.ensureRoots();
    return mediaRepository.createAssetAndSession({ ...input, extension: ext });
  },

  async uploadChunk(input: { sessionId: string; sellerId: string; chunkIndex: number; body: Buffer }) {
    const session = await mediaRepository.findSession(input.sessionId);
    if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Upload session not found");
    if (session.seller_id !== input.sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (session.status !== "active") throw new HttpError(409, "SESSION_REJECTED", "Session not active");
    if (input.chunkIndex >= session.total_chunks) throw new HttpError(400, "CHUNK_OUT_OF_RANGE", "Chunk out of range");
    const chunkPath = fileStorage.chunkPath(input.sessionId, input.chunkIndex);
    try {
      await mediaRepository.insertChunk({ sessionId: input.sessionId, chunkIndex: input.chunkIndex, chunkPath, sizeBytes: input.body.length });
      await fileStorage.writeChunk(chunkPath, input.body);
      return { status: "received" };
    } catch {
      return { status: "already_received" };
    }
  },

  async finalizeUpload(input: { sessionId: string; sellerId: string; detectedMime?: string }, actor: AuthUser) {
    const session = await mediaRepository.findSession(input.sessionId);
    if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Upload session not found");
    if (session.seller_id !== input.sellerId) throw new HttpError(403, "NOT_OWNER", "Not owner");
    if (session.status !== "active") throw new HttpError(409, "SESSION_REJECTED", "Session not active");

    const chunks = await mediaRepository.listChunks(input.sessionId);
    if (chunks.length !== session.total_chunks) throw new HttpError(400, "MISSING_CHUNKS", "Missing chunks");

    const assembled: Buffer[] = [];
    for (const chunk of chunks) {
      assembled.push(await fileStorage.readChunk(chunk.chunk_path));
    }
    const combined = Buffer.concat(assembled);

    const expected = mimeByExt[session.extension] ?? session.mime_type;
    const detectedMime = input.detectedMime?.toLowerCase();
    if (detectedMime && detectedMime !== expected) {
      await this.cleanupRejectedUpload(input.sessionId, session.asset_id, chunks.map((c) => c.chunk_path));
      throw new HttpError(400, "MIME_TYPE_MISMATCH", "Detected mime type does not match extension");
    }
    const sniffed = sniffMimeFromBuffer(combined);
    const sniffable = combined.length >= 12;
    if (sniffable && sniffed === null) {
      await this.cleanupRejectedUpload(input.sessionId, session.asset_id, chunks.map((c) => c.chunk_path));
      throw new HttpError(400, "MIME_TYPE_MISMATCH", "File content does not match extension");
    }
    if (sniffed !== null && sniffed !== expected) {
      await this.cleanupRejectedUpload(input.sessionId, session.asset_id, chunks.map((c) => c.chunk_path));
      throw new HttpError(400, "MIME_TYPE_MISMATCH", "File content does not match extension");
    }

    const assetPath = fileStorage.assetPath(session.asset_id, session.extension);
    await fileStorage.writeAsset(assetPath, combined);
    const fingerprint = await fileStorage.fingerprint(assetPath);
    const blockedFingerprint = await mediaRepository.findBlockedByFingerprint(fingerprint);
    if (blockedFingerprint) {
      await this.cleanupRejectedUpload(input.sessionId, session.asset_id, chunks.map((c) => c.chunk_path), assetPath);
      throw new HttpError(409, "FINGERPRINT_BLOCKED", "File fingerprint is blocked");
    }

    const base = await fileStorage.fileMetadata(assetPath);
    const metadata = { ...base };
    await mediaRepository.finalizeAsset({ sessionId: input.sessionId, assetId: session.asset_id, storagePath: assetPath, fingerprint, metadata });
    for (const chunk of chunks) {
      await fileStorage.removeFile(chunk.chunk_path);
    }
    signalAssetWorker();
    await auditRepository.create(actor, "media.finalize", "asset", session.asset_id);
    return { assetId: session.asset_id, status: "processing" };
  },

  async cleanupRejectedUpload(sessionId: string, assetId: string, chunkPaths: string[], assetPath?: string) {
    await mediaRepository.rejectSessionDeleteAsset(sessionId, assetId);
    for (const chunkPath of chunkPaths) {
      await fileStorage.removeFile(chunkPath);
    }
    if (assetPath) {
      await fileStorage.removeFile(assetPath);
    }
  },

  async getAsset(assetId: string) {
    const asset = await mediaRepository.findAssetById(assetId);
    if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    return asset;
  },

  async canActorAccessAsset(assetId: string, actor: AuthUser) {
    const asset = await this.getAsset(assetId);
    if (actor.roles.includes("admin") || actor.roles.includes("moderator")) {
      return asset;
    }
    if (actor.roles.includes("seller") && asset.seller_id === actor.id) {
      return asset;
    }
    if (actor.roles.includes("buyer")) {
      const canAccess = await mediaRepository.buyerHasCompletedOrderForListing({ buyerId: actor.id, listingId: asset.listing_id });
      if (canAccess) return asset;
    }
    throw new HttpError(403, "FORBIDDEN", "Forbidden");
  },

  async createSignedUrl(assetId: string) {
    const asset = await mediaRepository.findAssetById(assetId);
    if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Asset not found");
    const expiresAt = Math.floor(Date.now() / 1000) + config.signedUrlTtlMin * 60;
    const sig = hmacSha256(`${assetId}:${expiresAt}`, config.signedUrlSecret);
    return { url: `/download/${assetId}?exp=${expiresAt}&sig=${sig}`, expiresAt };
  },
};
