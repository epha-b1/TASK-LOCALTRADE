export const ALLOWED_EXTENSIONS = new Set(["jpg", "png", "mp4", "pdf"]);
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_FILES_PER_LISTING = 20;
export const CHUNK_SIZE = 5 * 1024 * 1024;

export function refundRequiresAdmin(amountCents: number): boolean {
  return amountCents > 25000;
}

export function reviewWindowOpen(completedAtIso: string, now: Date): boolean {
  const completedAt = new Date(completedAtIso);
  return now.getTime() - completedAt.getTime() <= 14 * 24 * 60 * 60 * 1000;
}

export function canCancelOrder(status: string): boolean {
  return status === "placed";
}

export function listingReadyToPublish(listingStatus: string, assets: Array<{ status: string }>): { ok: boolean; reason?: string } {
  if (listingStatus === "flagged") {
    return { ok: false, reason: "LISTING_FLAGGED" };
  }
  if (assets.length === 0) {
    return { ok: false, reason: "NO_ASSETS" };
  }
  if (assets.some((a) => a.status !== "ready")) {
    return { ok: false, reason: "ASSETS_NOT_READY" };
  }
  return { ok: true };
}

export function calcSellerCreditMetrics(ratings: Array<{ rating: number; createdAt: string }>, now: Date) {
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const inWindow = ratings.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
  if (inWindow.length === 0) {
    return { avgRating90d: null, positiveRate90d: null, reviewCount90d: 0 };
  }
  const sum = inWindow.reduce((acc, x) => acc + x.rating, 0);
  const positive = inWindow.filter((x) => x.rating >= 4).length;
  return {
    avgRating90d: Number((sum / inWindow.length).toFixed(2)),
    positiveRate90d: Number(((positive / inWindow.length) * 100).toFixed(4)),
    reviewCount90d: inWindow.length,
  };
}

export function normalizeRulePattern(ruleType: "keyword" | "regex", pattern: string): string {
  if (ruleType === "keyword" && !/[\\[\](){}.*+?^$|]/.test(pattern)) {
    return `\\b${pattern}\\b`;
  }
  return pattern;
}

export function positiveRateLabel(positiveRate: number | null): string | null {
  if (positiveRate === null) {
    return null;
  }
  if (positiveRate >= 90) {
    return "excellent";
  }
  if (positiveRate >= 75) {
    return "good";
  }
  return "watch";
}
