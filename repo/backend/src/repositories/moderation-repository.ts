import { pool } from "../db/pool.js";

export const moderationRepository = {
  async createDecision(input: { listingId: string; moderatorId: string; decision: "approve" | "reject"; notes: string }) {
    await pool.query(
      `INSERT INTO moderation_decisions(listing_id, moderator_id, decision, notes)
       VALUES($1, $2, $3, $4)`,
      [input.listingId, input.moderatorId, input.decision, input.notes],
    );
  },
};
