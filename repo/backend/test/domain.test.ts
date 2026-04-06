import { describe, expect, test } from "vitest";
import {
  calcSellerCreditMetrics,
  canCancelOrder,
  listingReadyToPublish,
  normalizeRulePattern,
  refundRequiresAdmin,
  reviewWindowOpen,
  MAX_JOB_RETRIES,
  MAX_REVIEW_IMAGES,
  JOB_RETRY_DELAY_MS,
} from "../src/domain.js";

describe("domain invariants", () => {
  test("refund threshold boundary is strict greater-than", () => {
    expect(refundRequiresAdmin(25000)).toBe(false);
    expect(refundRequiresAdmin(25001)).toBe(true);
  });

  test("review window includes exact 14-day boundary", () => {
    const completedAt = new Date("2026-01-01T00:00:00.000Z");
    const exactly14 = new Date(completedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const over14 = new Date(exactly14.getTime() + 1000);
    expect(reviewWindowOpen(completedAt.toISOString(), exactly14)).toBe(true);
    expect(reviewWindowOpen(completedAt.toISOString(), over14)).toBe(false);
  });

  test("cancel only allowed when status is placed", () => {
    expect(canCancelOrder("placed")).toBe(true);
    expect(canCancelOrder("payment_captured")).toBe(false);
    expect(canCancelOrder("completed")).toBe(false);
  });

  test("publish gate enforces asset readiness and flag state", () => {
    expect(listingReadyToPublish("flagged", [{ status: "ready" }]).ok).toBe(false);
    expect(listingReadyToPublish("draft", []).reason).toBe("NO_ASSETS");
    expect(listingReadyToPublish("draft", [{ status: "processing" }]).reason).toBe("ASSETS_NOT_READY");
    expect(listingReadyToPublish("draft", [{ status: "ready" }]).ok).toBe(true);
  });

  test("keyword rules are wrapped with whole-word boundaries", () => {
    expect(normalizeRulePattern("keyword", "gun")).toBe("\\bgun\\b");
    expect(normalizeRulePattern("regex", "\\bgun\\b")).toBe("\\bgun\\b");
  });

  test("credit metrics use rolling 90-day window", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const metrics = calcSellerCreditMetrics(
      [
        { rating: 5, createdAt: "2026-02-28T00:00:00.000Z" },
        { rating: 4, createdAt: "2026-01-15T00:00:00.000Z" },
        { rating: 1, createdAt: "2025-01-01T00:00:00.000Z" },
      ],
      now,
    );
    expect(metrics.avgRating90d).toBe(4.5);
    expect(metrics.positiveRate90d).toBe(100);
    expect(metrics.reviewCount90d).toBe(2);
  });

  test("MAX_JOB_RETRIES is 3 total attempts", () => {
    expect(MAX_JOB_RETRIES).toBe(3);
  });

  test("MAX_REVIEW_IMAGES limits buyer uploads to 5", () => {
    expect(MAX_REVIEW_IMAGES).toBe(5);
  });

  test("JOB_RETRY_DELAY_MS provides retry backoff", () => {
    expect(JOB_RETRY_DELAY_MS).toBeGreaterThan(0);
  });
});
