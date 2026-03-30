import { normalizeRulePattern } from "../domain.js";
import { auditRepository } from "../repositories/audit-repository.js";
import { contentRepository } from "../repositories/content-repository.js";
import type { AuthUser } from "../types/auth.js";
import { HttpError } from "../utils/http-error.js";

export const contentService = {
  async listRules() {
    return { items: await contentRepository.listRules() };
  },

  async createRule(input: { ruleType: "keyword" | "regex"; pattern: string; active: boolean }, actor: AuthUser) {
    const pattern = normalizeRulePattern(input.ruleType, input.pattern);
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new HttpError(400, "INVALID_REGEX", "Invalid regex");
    }
    const created = await contentRepository.createRule({ ...input, pattern });
    await auditRepository.create(actor, "content_rule.create", "content_rule", created.id);
    return created;
  },

  async testRule(ruleId: string, text: string) {
    const rule = await contentRepository.findRule(ruleId);
    if (!rule) throw new HttpError(404, "RULE_NOT_FOUND", "Rule not found");
    const matched = new RegExp(rule.pattern, "i").test(text);
    return { matched, matchDetail: matched ? "pattern matched" : null };
  },

  async updateRule(input: { id: string; ruleType?: "keyword" | "regex"; pattern?: string; active?: boolean }, actor: AuthUser) {
    let normalizedPattern = input.pattern;
    if (input.pattern && input.ruleType) {
      normalizedPattern = normalizeRulePattern(input.ruleType, input.pattern);
    }
    if (normalizedPattern) {
      try {
        new RegExp(normalizedPattern, "i");
      } catch {
        throw new HttpError(400, "INVALID_REGEX", "Invalid regex");
      }
    }
    const updated = await contentRepository.updateRule({ ...input, pattern: normalizedPattern });
    if (!updated) throw new HttpError(404, "RULE_NOT_FOUND", "Rule not found");
    await auditRepository.create(actor, "content_rule.update", "content_rule", input.id, undefined, input);
    return updated;
  },

  async deleteRule(id: string, actor: AuthUser) {
    const deleted = await contentRepository.softDeleteRule(id);
    if (!deleted) throw new HttpError(404, "RULE_NOT_FOUND", "Rule not found");
    await auditRepository.create(actor, "content_rule.delete", "content_rule", id);
    return { id, active: false };
  },
};
