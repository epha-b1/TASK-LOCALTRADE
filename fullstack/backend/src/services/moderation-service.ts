import { auditRepository } from "../repositories/audit-repository.js";
import { listingRepository } from "../repositories/listing-repository.js";
import { moderationRepository } from "../repositories/moderation-repository.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

export const moderationService = {
  async queue() {
    return { items: await listingRepository.listFlagged() };
  },

  async decide(input: { listingId: string; moderatorId: string; decision: "approve" | "reject"; notes: string }, actor: AuthUser) {
    const listing = await listingRepository.findById(input.listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found");
    if (listing.status !== "flagged") throw new HttpError(409, "LISTING_NOT_FLAGGED", "Listing not flagged");
    await moderationRepository.createDecision(input);
    const status = input.decision === "approve" ? "draft" : "removed";
    await listingRepository.setStatus(input.listingId, status);
    await auditRepository.create(actor, "moderation.decision", "listing", input.listingId, undefined, input);
    return { listingId: input.listingId, status, decisionId: "created" };
  },
};
