import { pool } from "../db/pool.js";

export const contentRepository = {
  async listActiveRules() {
    const result = await pool.query("SELECT id, pattern FROM content_rules WHERE active = true AND deleted_at IS NULL ORDER BY created_at ASC");
    return result.rows as Array<{ id: string; pattern: string }>;
  },

  async listRules() {
    const result = await pool.query("SELECT id, rule_type, pattern, active, created_at, deleted_at FROM content_rules ORDER BY created_at DESC");
    return result.rows;
  },

  async createRule(input: { ruleType: "keyword" | "regex"; pattern: string; active: boolean }) {
    const result = await pool.query(
      `INSERT INTO content_rules(rule_type, pattern, active)
       VALUES($1, $2, $3)
       RETURNING id, rule_type, pattern, active`,
      [input.ruleType, input.pattern, input.active],
    );
    return result.rows[0];
  },

  async findRule(id: string) {
    const result = await pool.query("SELECT id, pattern, rule_type, active, deleted_at FROM content_rules WHERE id = $1", [id]);
    return result.rows[0] as { id: string; pattern: string } | undefined;
  },

  async updateRule(input: { id: string; ruleType?: "keyword" | "regex"; pattern?: string; active?: boolean }) {
    const result = await pool.query(
      `UPDATE content_rules
       SET rule_type = COALESCE($1, rule_type),
           pattern = COALESCE($2, pattern),
           active = COALESCE($3, active)
       WHERE id = $4
       RETURNING id, rule_type, pattern, active, created_at, deleted_at`,
      [input.ruleType ?? null, input.pattern ?? null, input.active ?? null, input.id],
    );
    return result.rows[0];
  },

  async softDeleteRule(id: string) {
    const result = await pool.query(
      `UPDATE content_rules
       SET active = false, deleted_at = NOW()
       WHERE id = $1
       RETURNING id, rule_type, pattern, active, created_at, deleted_at`,
      [id],
    );
    return result.rows[0];
  },

  async createScanResult(input: { listingId?: string; assetId?: string; ruleId?: string; verdict: string; detail: string }) {
    await pool.query(
      `INSERT INTO content_scan_results(listing_id, asset_id, rule_id, verdict, detail)
       VALUES($1, $2, $3, $4, $5)`,
      [input.listingId ?? null, input.assetId ?? null, input.ruleId ?? null, input.verdict, input.detail],
    );
  },
};
