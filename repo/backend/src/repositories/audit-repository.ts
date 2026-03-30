import { pool } from "../db/pool.js";
import type { AuthUser } from "../types/auth.js";

export const auditRepository = {
  async create(actor: AuthUser | null, action: string, targetType: string, targetId: string, beforeJson?: unknown, afterJson?: unknown) {
    await pool.query(
      `INSERT INTO audit_logs(actor_user_id, actor_roles, action, target_type, target_id, before_json, after_json)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [actor?.id ?? null, actor?.roles ?? [], action, targetType, targetId, beforeJson ? JSON.stringify(beforeJson) : null, afterJson ? JSON.stringify(afterJson) : null],
    );
  },

  async list(limit = 500) {
    const result = await pool.query("SELECT id, actor_user_id, action, target_type, target_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows;
  },

  async listFiltered(input: {
    page: number;
    pageSize: number;
    action?: string;
    targetType?: string;
    actorId?: string;
    from?: string;
    to?: string;
  }) {
    const whereData: string[] = [];
    const whereCount: string[] = [];
    const values: any[] = [];
    const add = (clauseData: string, clauseCount: string, value: unknown) => {
      values.push(value);
      const param = `$${values.length}`;
      whereData.push(clauseData.replace("?", param));
      whereCount.push(clauseCount.replace("?", param));
    };

    if (input.action) add("a.action = ?", "action = ?", input.action);
    if (input.targetType) add("a.target_type = ?", "target_type = ?", input.targetType);
    if (input.actorId) add("a.actor_user_id = ?", "actor_user_id = ?", input.actorId);
    if (input.from) add("a.created_at >= ?::timestamptz", "created_at >= ?::timestamptz", input.from);
    if (input.to) add("a.created_at <= ?::timestamptz", "created_at <= ?::timestamptz", input.to);

    const whereSqlData = whereData.length ? `WHERE ${whereData.join(" AND ")}` : "";
    const whereSqlCount = whereCount.length ? `WHERE ${whereCount.join(" AND ")}` : "";
    const offset = (input.page - 1) * input.pageSize;

    const rowsSql = `SELECT a.id, a.actor_user_id, u.email AS actor_email, a.action, a.target_type, a.target_id, a.created_at
                     FROM audit_logs a
                     LEFT JOIN users u ON u.id = a.actor_user_id
                     ${whereSqlData}
                     ORDER BY a.created_at DESC
                     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const countSql = `SELECT COUNT(*)::int AS c FROM audit_logs ${whereSqlCount}`;

    const [rowsResult, totalResult] = await Promise.all([
      pool.query(rowsSql, [...values, input.pageSize, offset]),
      pool.query(countSql, values),
    ]);

    return { items: rowsResult.rows, total: Number(totalResult.rows[0].c) };
  },

  async findById(id: string) {
    const result = await pool.query("SELECT * FROM audit_logs WHERE id = $1", [id]);
    return result.rows[0] as Record<string, unknown> | undefined;
  },
};
