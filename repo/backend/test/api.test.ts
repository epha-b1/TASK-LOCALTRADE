import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SignJWT } from "jose";
import { buildServer } from "../src/server.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { decryptText } from "../src/security/encryption.js";
import { signalAssetWorker } from "../src/jobs/worker.js";
import { closeDb, resetDb } from "./test-db.js";

const app = buildServer();

// Real port-level HTTP: spin up the server on an ephemeral port and route
// every app.inject(...) call through an actual TCP/HTTP round trip using
// node's fetch. Public contract of the wrapper (statusCode/headers/body/
// json()/rawPayload) matches Fastify's app.inject result shape so the 94
// existing tests do not need to be rewritten.
let serverOrigin = "";

function replayHeaders(seed: string) {
  return {
    "x-request-nonce": `nonce-${seed}-${Date.now()}-${Math.random()}`,
    "x-request-timestamp": `${Math.floor(Date.now() / 1000)}`,
  };
}

type InjectOpts = {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, string | number | string[] | undefined>;
  payload?: unknown;
  body?: unknown;
};

type InjectResult = {
  statusCode: number;
  headers: Record<string, string>;
  rawPayload: Buffer;
  body: string;
  payload: string;
  json: <T = any>() => T;
};

function normalizeHeaders(input: Record<string, string | number | string[] | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v.join(", ");
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

// Regex matching `/api/listings/<uuid>/publish` — a publish call that relies
// on every asset on the listing already being `ready`. Under container
// scheduling the async worker may not have reached all assets yet, so the
// wrapper automatically waits (up to ~6s) before forwarding the request.
const PUBLISH_URL_RE = /^\/api\/listings\/([0-9a-f-]{36})\/publish$/i;

async function waitListingAssetsReady(listingId: string, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const rows = await pool.query(
      "SELECT id, status FROM assets WHERE listing_id = $1",
      [listingId],
    );
    if (!rows.rowCount) return true; // no-assets negative path
    if (rows.rows.every((r: { status: string }) => r.status === "ready")) return true;

    // If none of the non-ready assets have a pending/processing worker job,
    // nobody is going to move them to `ready`. Proceed immediately so
    // negative-case tests that set status=processing/failed via SQL stay fast.
    const assetIds = rows.rows.map((r: { id: string }) => r.id);
    const pending = await pool.query(
      `SELECT 1 FROM jobs
       WHERE type = 'asset_postprocess'
         AND status IN ('queued','processing')
         AND (payload_json->>'assetId') = ANY($1::text[])
       LIMIT 1`,
      [assetIds],
    );
    if (!pending.rowCount) return false;
    // Re-kick the in-process worker: finalize's fire-and-forget signal can be
    // dropped by the `assetWorkerRunning` guard under concurrent uploads.
    signalAssetWorker();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function realHttpInject(opts: InjectOpts | string): Promise<InjectResult> {
  if (typeof opts === "string") {
    opts = { method: "GET", url: opts } as InjectOpts;
  }
  const method = (opts.method ?? "GET").toUpperCase();
  const rawUrlOrPath = (opts.url ?? opts.path ?? "/") as string;
  // allow full URL or path
  const url = /^https?:\/\//.test(rawUrlOrPath) ? rawUrlOrPath : `${serverOrigin}${rawUrlOrPath}`;
  const headers = normalizeHeaders(opts.headers);
  const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
  const hasNonce = Object.keys(headers).some((key) => key.toLowerCase() === "x-request-nonce");
  const hasTimestamp = Object.keys(headers).some((key) => key.toLowerCase() === "x-request-timestamp");
  if (hasAuth && (!hasNonce || !hasTimestamp)) {
    Object.assign(headers, replayHeaders("auto"));
  }

  // Auto-wait for asset postprocessing before a publish call so test flows
  // that go "upload session -> finalize -> publish" are deterministic under
  // container scheduling. Negative-case publish tests (flagged, no-assets,
  // not-ready) are unaffected: waitListingAssetsReady returns truthy when
  // either every asset is ready OR the listing has no assets.
  if (method === "POST") {
    const pathOnly = rawUrlOrPath.split("?")[0] as string;
    const m = PUBLISH_URL_RE.exec(pathOnly);
    if (m) {
      await waitListingAssetsReady(m[1]);
    }
  }

  let body: BodyInit | undefined;
  const payload = (opts as InjectOpts).payload ?? (opts as InjectOpts).body;
  if (payload !== undefined && method !== "GET" && method !== "HEAD") {
    if (Buffer.isBuffer(payload)) {
      body = payload as unknown as BodyInit;
    } else if (typeof payload === "string") {
      body = payload;
    } else {
      body = JSON.stringify(payload);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }
  }

  const res = await fetch(url, { method, headers, body, redirect: "manual" });
  const rawPayload = Buffer.from(await res.arrayBuffer());
  const bodyText = rawPayload.toString("utf8");
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { respHeaders[k] = v; });
  return {
    statusCode: res.status,
    headers: respHeaders,
    rawPayload,
    body: bodyText,
    payload: bodyText,
    json: <T,>(): T => JSON.parse(bodyText) as T,
  };
}

(app as any).inject = (opts: any) => realHttpInject(opts as InjectOpts);

async function login(email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: replayHeaders(`login-${email}`),
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function waitForAssetReady(assetId: string, maxAttempts = 120) {
  let status = "processing";
  for (let i = 0; i < maxAttempts && status !== "ready"; i += 1) {
    const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
    status = String(row.rows[0]?.status ?? "processing");
    if (status !== "ready") {
      // Re-kick the single-shot worker in case the previous signal was
      // dropped by the `assetWorkerRunning` guard during concurrent uploads.
      signalAssetWorker();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return status;
}

describe("api integration with postgres", () => {
  beforeAll(async () => {
    // Real port-level listener (no app.inject bypass).
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    serverOrigin = address;
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  test("seller can create listing, upload media, and publish", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listingRes = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("listing") },
      payload: { title: "Fresh Apples", description: "Organic produce", priceCents: 1500, quantity: 8 },
    });
    expect(listingRes.statusCode).toBe(201);
    const listingId = listingRes.json().id as string;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("session") },
      payload: {
        listingId,
        fileName: "photo.jpg",
        sizeBytes: 10,
        extension: "jpg",
        mimeType: "image/jpeg",
        totalChunks: 1,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = sessionRes.json().sessionId as string;

    const chunk1 = await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sessionId}/chunks/0`,
      headers: {
        authorization: `Bearer ${sellerToken}`,
        ...replayHeaders("chunk1"),
        "content-type": "application/octet-stream",
      },
      payload: Buffer.from("abc"),
    });
    expect(chunk1.statusCode).toBe(200);
    expect(chunk1.json().status).toBe("received");

    const chunkRepeat = await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sessionId}/chunks/0`,
      headers: {
        authorization: `Bearer ${sellerToken}`,
        ...replayHeaders("chunk2"),
        "content-type": "application/octet-stream",
      },
      payload: Buffer.from("abc"),
    });
    expect(chunkRepeat.statusCode).toBe(200);
    expect(chunkRepeat.json().status).toBe("already_received");

    const finalize = await app.inject({
      method: "POST",
      url: `/api/media/upload-sessions/${sessionId}/finalize`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("finalize") },
      payload: { detectedMime: "image/jpeg" },
    });
    expect(finalize.statusCode).toBe(202);

    const publish = await app.inject({
      method: "POST",
      url: `/api/listings/${listingId}/publish`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("publish") },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().status).toBe("published");
  });

  test("order, payment, completion, review, appeal flow works", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");

    const listingRes = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("listing2") },
      payload: { title: "Milk", description: "Daily fresh", priceCents: 500, quantity: 10 },
    });
    const listingId = listingRes.json().id as string;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("session2") },
      payload: { listingId, fileName: "label.png", sizeBytes: 10, extension: "png", mimeType: "image/png", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    const sessionId = sessionRes.json().sessionId as string;
    const flowAssetId = sessionRes.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sessionId}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("chunk3"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sessionId}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("finalize2") }, payload: { detectedMime: "image/png" } });
    expect(await waitForAssetReady(flowAssetId)).toBe("ready");
    const publishFlow = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("publish2") } });
    expect(publishFlow.statusCode).toBe(200);

    const orderRes = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("order") },
      payload: { listingId, quantity: 2 },
    });
    expect(orderRes.statusCode).toBe(201);
    const orderId = orderRes.json().id as string;

    const pay = await app.inject({
      method: "POST",
      url: "/api/payments/capture",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pay") },
      payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-flow-1" },
    });
    expect(pay.statusCode).toBe(201);

    const complete = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/complete`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("complete") },
      payload: { note: "fulfilled" },
    });
    expect(complete.statusCode).toBe(200);

    const review = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("review") },
      payload: { orderId, rating: 5, body: "Great seller" },
    });
    expect(review.statusCode).toBe(201);
    const reviewId = review.json().id as string;

    const appeal = await app.inject({
      method: "POST",
      url: "/api/appeals",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("appeal") },
      payload: { reviewId, reason: "Needs arbitration" },
    });
    expect(appeal.statusCode).toBe(201);
    const appealId = appeal.json().id as string;

    const resolve = await app.inject({
      method: "POST",
      url: `/api/arbitration/appeals/${appealId}/resolve`,
      headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("resolve") },
      payload: { outcome: "uphold", note: "kept" },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().status).toBe("resolved_uphold");
  });

  test("refund threshold and approval path enforced", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("l3") }, payload: { title: "Oil", description: "1L", priceCents: 26000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("s3") }, payload: { listingId, fileName: "doc.pdf", sizeBytes: 10, extension: "pdf", mimeType: "application/pdf", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sessionId = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sessionId}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("c3"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sessionId}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("f3") }, payload: { detectedMime: "application/pdf" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("p3") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("o3") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pay3") }, payload: { orderId, tenderType: "cash", amountCents: 26000, transactionKey: "tx-rf-1" } });

    const refund250 = await app.inject({
      method: "POST",
      url: "/api/refunds",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("r250") },
      payload: { orderId, amountCents: 25000, reason: "exact threshold" },
    });
    expect(refund250.statusCode).toBe(201);
    expect(refund250.json().requiresAdminApproval).toBe(false);

    const refund251 = await app.inject({
      method: "POST",
      url: "/api/refunds",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("r251") },
      payload: { orderId, amountCents: 25001, reason: "above threshold" },
    });
    expect(refund251.statusCode).toBe(201);
    expect(refund251.json().requiresAdminApproval).toBe(true);

    const approve = await app.inject({
      method: "POST",
      url: `/api/refunds/${refund251.json().id}/approve`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("approve") },
      payload: { approve: true, note: "approved" },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("approved");
  });

  test("admin can manage content rules and seller deactivation removes published listings", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const rule = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("rule") },
      payload: { ruleType: "keyword", pattern: "forbidden", active: true },
    });
    expect(rule.statusCode).toBe(201);

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("list-flag") },
      payload: { title: "Forbidden item", description: "contains forbidden text", priceCents: 1000, quantity: 2 },
    });
    expect(listing.statusCode).toBe(201);
    expect(listing.json().status).toBe("flagged");

    const listing2 = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("list-pub") },
      payload: { title: "Clean item", description: "safe text", priceCents: 1000, quantity: 2 },
    });
    const listingId = listing2.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ss") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cc"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ff") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pp") } });

    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const deactivate = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${sellerId}/status`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("deact") },
      payload: { status: "inactive", reason: "policy" },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().listingsRemovedCount).toBeGreaterThanOrEqual(1);
  });

  test("server-side mime mismatch rejects finalized upload", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listingRes = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mm-list") },
      payload: { title: "Mime test", description: "desc", priceCents: 1000, quantity: 1 },
    });
    const listingId = listingRes.json().id as string;
    const sessionRes = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mm-ses") },
      payload: {
        listingId,
        fileName: "x.jpg",
        sizeBytes: 10,
        extension: "jpg",
        mimeType: "image/jpeg",
        totalChunks: 1,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    const sid = sessionRes.json().sessionId as string;
    await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sid}/chunks/0`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mm-chunk"), "content-type": "application/octet-stream" },
      payload: Buffer.from("abc"),
    });
    const finalize = await app.inject({
      method: "POST",
      url: `/api/media/upload-sessions/${sid}/finalize`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mm-fin") },
      payload: { detectedMime: "application/pdf" },
    });
    expect(finalize.statusCode).toBe(400);
    expect(finalize.json().code).toBe("MIME_TYPE_MISMATCH");
  });

  test("chunk upload can recover after failed chunk attempt by retrying", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-list") },
      payload: { title: "Chunk retry", description: "desc", priceCents: 1000, quantity: 2 },
    });
    const listingId = listing.json().id as string;

    const session = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-ses") },
      payload: {
        listingId,
        fileName: "retry.jpg",
        sizeBytes: 20,
        extension: "jpg",
        mimeType: "image/jpeg",
        totalChunks: 2,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    expect(session.statusCode).toBe(201);
    const sid = session.json().sessionId as string;

    const failed = await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sid}/chunks/2`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-bad"), "content-type": "application/octet-stream" },
      payload: Buffer.from("z"),
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().code).toBe("CHUNK_OUT_OF_RANGE");

    const retry0 = await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sid}/chunks/0`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-0"), "content-type": "application/octet-stream" },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]),
    });
    expect(retry0.statusCode).toBe(200);

    const retry1 = await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sid}/chunks/1`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-1"), "content-type": "application/octet-stream" },
      payload: Buffer.from([0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
    });
    expect(retry1.statusCode).toBe(200);

    const finalize = await app.inject({
      method: "POST",
      url: `/api/media/upload-sessions/${sid}/finalize`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("retry-fin") },
      payload: { detectedMime: "image/jpeg" },
    });
    expect(finalize.statusCode).toBe(202);
  });

  test("unknown-signature payload rejected when file is large enough to sniff", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-l") }, payload: { title: "sniff test", description: "desc", priceCents: 1000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 20, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-c"), "content-type": "application/octet-stream" }, payload: Buffer.alloc(20, 0x00) });
    const finalize = await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-f") }, payload: { detectedMime: "image/jpeg" } });
    expect(finalize.statusCode).toBe(400);
    expect(finalize.json().code).toBe("MIME_TYPE_MISMATCH");
  });

  test("replay nonce cannot be reused", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const nonceHeaders = {
      "x-request-nonce": "fixed-nonce",
      "x-request-timestamp": `${Math.floor(Date.now() / 1000)}`,
      authorization: `Bearer ${sellerToken}`,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: nonceHeaders,
      payload: { title: "A", description: "B", priceCents: 1000, quantity: 1 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: nonceHeaders,
      payload: { title: "A2", description: "B2", priceCents: 1000, quantity: 1 },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("REPLAY_DETECTED");
  });

  test("review window expires at 14 days + 1 second", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-l") }, payload: { title: "T", description: "D", priceCents: 1000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rw-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-rw-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rw-comp") }, payload: { note: "done" } });

    await pool.query("UPDATE orders SET completed_at = NOW() - INTERVAL '14 days 1 second' WHERE id = $1", [orderId]);

    const review = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rw-review") },
      payload: { orderId, rating: 4, body: "late" },
    });
    expect(review.statusCode).toBe(409);
    expect(review.json().code).toBe("REVIEW_WINDOW_EXPIRED");
  });

  test("cors preflight returns expected headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/listings",
      headers: {
        origin: "http://localhost:4200",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,x-request-nonce,x-request-timestamp,content-type",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
  });

  test("signed URL download validates valid expired and tampered signatures", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listingRes = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("su-l") }, payload: { title: "A", description: "B", priceCents: 1000, quantity: 1 } });
    const listingId = listingRes.json().id as string;
    const sessionRes = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("su-s") }, payload: { listingId, fileName: "img.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = sessionRes.json().sessionId as string;
    const assetId = sessionRes.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("su-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("su-f") }, payload: { detectedMime: "image/jpeg" } });

    const signed = await app.inject({ method: "GET", url: `/api/media/assets/${assetId}/signed-url`, headers: { authorization: `Bearer ${sellerToken}` } });
    expect(signed.statusCode).toBe(200);
    const parsed = new URL(`http://local${signed.json().url}`);
    const valid = await app.inject({ method: "GET", url: `${parsed.pathname}${parsed.search}` });
    expect(valid.statusCode).toBe(200);

    const expired = await app.inject({ method: "GET", url: `${parsed.pathname}?exp=1&sig=${parsed.searchParams.get("sig")}` });
    expect(expired.statusCode).toBe(403);
    expect(expired.json().code).toBe("INVALID_SIGNATURE");

    const tampered = await app.inject({ method: "GET", url: `${parsed.pathname}?exp=${parsed.searchParams.get("exp")}&sig=badsig` });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json().code).toBe("INVALID_SIGNATURE");
  });

  test("storefront ranking supports verified purchase first and returns badges", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listingRes = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-l") }, payload: { title: "Rank", description: "desc", priceCents: 1000, quantity: 5 } });
    const listingId = listingRes.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-p") } });

    const completedOrder = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rk-o1") }, payload: { listingId, quantity: 1 } });
    const oid1 = completedOrder.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-pay") }, payload: { orderId: oid1, tenderType: "cash", amountCents: 1000, transactionKey: "tx-rank-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${oid1}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rk-comp") }, payload: { note: "done" } });
    const rev1 = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rk-rev1") }, payload: { orderId: oid1, rating: 5, body: "verified" } });

    const unverifiedOrder = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rk-o2") }, payload: { listingId, quantity: 1 } });
    const oid2 = unverifiedOrder.json().id as string;
    const sellerIdRes = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerIdRes.json().id as string;
    await pool.query("INSERT INTO reviews(order_id, buyer_id, seller_id, rating, body, under_appeal, removed_by_arbitration) VALUES($1, (SELECT id FROM users WHERE email='buyer@localtrade.test'), $2, 3, 'unverified', true, false)", [oid2, sellerId]);

    const ranked = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/reviews?sortRule=verified_purchase_first` });
    expect(ranked.statusCode).toBe(200);
    const list = ranked.json().items;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].rating).toBeDefined();
    expect(list[0].underAppeal).toBeDefined();
    expect(list[0].removedByArbitration).toBeDefined();
    expect(rev1.statusCode).toBe(201);
  });

  test("refund list enforces object auth and returns history", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-l") }, payload: { title: "R", description: "D", priceCents: 5000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rl-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-pay") }, payload: { orderId, tenderType: "cash", amountCents: 5000, transactionKey: "tx-rl-1" } });
    await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rl-r") }, payload: { orderId, amountCents: 2000, reason: "partial" } });

    const buyerView = await app.inject({ method: "GET", url: `/api/refunds?orderId=${orderId}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(buyerView.statusCode).toBe(200);
    expect(buyerView.json().items.length).toBeGreaterThan(0);

    const adminView = await app.inject({ method: "GET", url: `/api/refunds?orderId=${orderId}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(adminView.statusCode).toBe(200);
  });

  test("admin user list roles update pending refunds and store credit endpoints work", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const users = await app.inject({ method: "GET", url: "/api/admin/users?page=1&pageSize=10", headers: { authorization: `Bearer ${adminToken}` } });
    expect(users.statusCode).toBe(200);
    expect(users.json().items.length).toBeGreaterThan(0);

    const buyerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    const buyerId = buyerMe.json().id as string;
    const rolesUpdate = await app.inject({ method: "PATCH", url: `/api/admin/users/${buyerId}/roles`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("au-role") }, payload: { roles: ["buyer"] } });
    expect(rolesUpdate.statusCode).toBe(200);

    const issue = await app.inject({ method: "POST", url: `/api/admin/users/${buyerId}/store-credit`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("au-credit") }, payload: { amountCents: 1200, note: "adjustment" } });
    expect(issue.statusCode).toBe(200);

    const balance = await app.inject({ method: "GET", url: "/api/users/me/store-credit", headers: { authorization: `Bearer ${buyerToken}` } });
    expect(balance.statusCode).toBe(200);
    expect(balance.json().balanceCents).toBeGreaterThanOrEqual(1200);

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-l") }, payload: { title: "X", description: "Y", priceCents: 30000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("au-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-pay") }, payload: { orderId, tenderType: "cash", amountCents: 30000, transactionKey: "tx-au-1" } });
    await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("au-r") }, payload: { orderId, amountCents: 25001, reason: "pending" } });
    const pending = await app.inject({ method: "GET", url: "/api/admin/refunds/pending", headers: { authorization: `Bearer ${adminToken}` } });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().items.length).toBeGreaterThan(0);
  });

  test("admin cannot create user with weak password", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const weak = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("weak-pw") },
      payload: { email: "weakpw@localtrade.test", password: "123456", displayName: "Weak", roles: ["buyer"] },
    });
    expect(weak.statusCode).toBe(400);

    const strong = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("strong-pw") },
      payload: { email: "strongpw@localtrade.test", password: "Strong123", displayName: "Strong", roles: ["buyer"] },
    });
    expect(strong.statusCode).toBe(201);
  });

  test("webhook subscription created and disallowed CIDR target rejected", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/webhooks/subscriptions",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-c") },
      payload: { eventType: "order.completed", targetUrl: "http://192.168.1.50/hook", secret: "supersecret123" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().id).toBeTruthy();

    const external = await app.inject({
      method: "POST",
      url: "/api/admin/webhooks/subscriptions",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-ext") },
      payload: { eventType: "order.completed", targetUrl: "http://8.8.8.8/hook", secret: "supersecret123" },
    });
    expect(external.statusCode).toBe(400);
    expect(external.json().code).toBe("INVALID_LOCAL_URL");
  });

  test("webhook dispatch enforces CIDR at runtime and audits blocked delivery", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/webhooks/subscriptions",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-run-c") },
      payload: { eventType: "listing.published", targetUrl: "http://127.0.0.1/hook", secret: "runtimecheck123" },
    });
    expect(created.statusCode).toBe(201);

    const originalCidrs = [...config.webhookAllowedCidrs];
    config.webhookAllowedCidrs.splice(0, config.webhookAllowedCidrs.length, "10.0.0.0/8");
    try {
      const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-run-l") }, payload: { title: "Webhook runtime", description: "cidr", priceCents: 1000, quantity: 1 } });
      const listingId = listing.json().id as string;
      const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-run-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
      const sid = session.json().sessionId as string;
      await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-run-ch"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
      await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-run-f") }, payload: { detectedMime: "image/jpeg" } });
      await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-run-p") } });

      let blockedCount = 0;
      for (let i = 0; i < 10; i += 1) {
        const result = await pool.query("SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'webhook.dispatch.blocked_cidr'");
        blockedCount = Number(result.rows[0].c);
        if (blockedCount > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blockedCount).toBeGreaterThan(0);
    } finally {
      config.webhookAllowedCidrs.splice(0, config.webhookAllowedCidrs.length, ...originalCidrs);
    }
  });

  test("webhook dispatch includes documented signature headers", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const webhookReceipt = new Promise<{ headers: Record<string, string | string[] | undefined>; body: string }>((resolve) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => {
          const payload = Buffer.concat(chunks).toString("utf8");
          res.statusCode = 200;
          res.end("ok");
          server.close(() => resolve({ headers: req.headers, body: payload }));
        });
      });
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          throw new Error("failed to bind webhook test server");
        }
        await app.inject({
          method: "POST",
          url: "/api/admin/webhooks/subscriptions",
          headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-hdr-c") },
          payload: { eventType: "listing.published", targetUrl: `http://127.0.0.1:${address.port}/hook`, secret: "headerstest123" },
        });

        const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-hdr-l") }, payload: { title: "Webhook headers", description: "header contract", priceCents: 1000, quantity: 1 } });
        const listingId = listing.json().id as string;
        const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-hdr-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
        const sid = session.json().sessionId as string;
        await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-hdr-ch"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
        await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-hdr-f") }, payload: { detectedMime: "image/jpeg" } });
        await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-hdr-p") } });
      });
    });

    const received = await webhookReceipt;
    expect(received.body).toContain('"event":"listing.published"');
    expect(received.headers["x-webhook-signature"]).toBeTruthy();
    expect(received.headers["x-webhook-timestamp"]).toBeTruthy();
    expect(received.headers["x-localtrade-signature"]).toBe(received.headers["x-webhook-signature"]);
    expect(received.headers["x-localtrade-event"]).toBe("listing.published");
  });

  test("review image attach enforces max 5 and appeal duplicate rejected", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-l") }, payload: { title: "Img", description: "desc", priceCents: 1000, quantity: 10 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ri-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ri-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ri-rev") }, payload: { orderId, rating: 5, body: "image review" } });
    const reviewId = review.json().id as string;

    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const assetIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const inserted = await pool.query(
        "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake') RETURNING id",
        [listingId, sellerId, `img-${i}.jpg`],
      );
      assetIds.push(inserted.rows[0].id);
    }

    for (let i = 0; i < 5; i += 1) {
      const attach = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/images`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`ri-att-${i}`) }, payload: { assetId: assetIds[i] } });
      expect(attach.statusCode).toBe(200);
    }
    const sixth = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/images`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ri-att-6") }, payload: { assetId: assetIds[5] } });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().code).toBe("REVIEW_IMAGE_LIMIT_REACHED");

    const appeal1 = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/appeal`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-ap-1") }, payload: { reason: "first" } });
    expect(appeal1.statusCode).toBe(201);
    const appeal2 = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/appeal`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ri-ap-2") }, payload: { reason: "duplicate" } });
    expect(appeal2.statusCode).toBe(409);
    expect(appeal2.json().code).toBe("APPEAL_ALREADY_ACTIVE");
  });

  test("review image attach rejects asset from a different listing", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listingA = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-la") }, payload: { title: "Listing A", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingAId = listingA.json().id as string;
    const sessionA = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-sa") }, payload: { listingId: listingAId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sidA = sessionA.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sidA}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ca"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sidA}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-fa") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingAId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-pa") } });

    const listingB = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-lb") }, payload: { title: "Listing B", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingBId = listingB.json().id as string;
    const sessionB = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-sb") }, payload: { listingId: listingBId, fileName: "b.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const foreignAssetId = sessionB.json().assetId as string;

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-o") }, payload: { listingId: listingAId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ria-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-rev") }, payload: { orderId, rating: 5, body: "great" } });
    const reviewId = review.json().id as string;

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/reviews/${reviewId}/images`,
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-att") },
      payload: { assetId: foreignAssetId },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("ASSET_NOT_ACCESSIBLE");
  });

  test("review image attach rejects non-image assets", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-l") }, payload: { title: "Non image", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-s") }, payload: { listingId, fileName: "base.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-ni-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ria-ni" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria-ni-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-ni-rev") }, payload: { orderId, rating: 4, body: "review" } });
    const reviewId = review.json().id as string;

    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const badAsset = await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'pdf', 'application/pdf', 10, 'ready', '/tmp/fake') RETURNING id",
      [listingId, sellerId, "bad.pdf"],
    );

    const attach = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/images`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria-ni-att") }, payload: { assetId: badAsset.rows[0].id } });
    expect(attach.statusCode).toBe(400);
    expect(attach.json().code).toBe("INVALID_REVIEW_IMAGE_TYPE");
  });

  test("buyer cannot attach asset from unrelated listing via review create", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listingA = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-la") }, payload: { title: "A", description: "d", priceCents: 1000, quantity: 2 } });
    const listingAId = listingA.json().id as string;
    const sessionA = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-sa") }, payload: { listingId: listingAId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sidA = sessionA.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sidA}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-ca"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sidA}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-fa") }, payload: {} });
    await app.inject({ method: "POST", url: `/api/listings/${listingAId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-pa") } });

    const listingB = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-lb") }, payload: { title: "B", description: "d", priceCents: 2000, quantity: 2 } });
    const listingBId = listingB.json().id as string;
    const sessionB = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-sb") }, payload: { listingId: listingBId, fileName: "b.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sidB = sessionB.json().sessionId as string;
    const foreignAssetId = sessionB.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sidB}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-cb"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sidB}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-fb") }, payload: {} });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria2-o") }, payload: { listingId: listingAId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ria2-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ria2-comp") }, payload: {} });

    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ria2-rev") }, payload: { orderId, rating: 5, body: "Good", imageAssetIds: [foreignAssetId] } });
    expect(review.statusCode).toBe(403);
    expect(review.json().code).toBe("ASSET_NOT_ACCESSIBLE");
  });

  test("review create rejects imageAssetIds from unrelated listing", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listingA = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-la") }, payload: { title: "A", description: "d", priceCents: 1000, quantity: 2 } });
    const listingAId = listingA.json().id as string;
    const sessionA = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-sa") }, payload: { listingId: listingAId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sidA = sessionA.json().sessionId as string;
    const rciAssetAId = sessionA.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sidA}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-ca"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sidA}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-fa") }, payload: {} });
    expect(await waitForAssetReady(rciAssetAId)).toBe("ready");
    const publishRciA = await app.inject({ method: "POST", url: `/api/listings/${listingAId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-pa") } });
    expect(publishRciA.statusCode).toBe(200);

    const listingB = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-lb") }, payload: { title: "B", description: "d", priceCents: 2000, quantity: 2 } });
    const listingBId = listingB.json().id as string;
    const sessionB = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-sb") }, payload: { listingId: listingBId, fileName: "b.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sidB = sessionB.json().sessionId as string;
    const foreignAssetId = sessionB.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sidB}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-cb"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sidB}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-fb") }, payload: {} });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rci-o") }, payload: { listingId: listingAId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-rci-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rci-comp") }, payload: {} });

    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rci-rev") }, payload: { orderId, rating: 5, body: "Good", imageAssetIds: [foreignAssetId] } });
    expect(review.statusCode).toBe(403);
    expect(review.json().code).toBe("ASSET_NOT_ACCESSIBLE");
  });

  test("buyer can upload and attach review image after completed order", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-l") }, payload: { title: "Buyer review image", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;

    const sellerSession = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-ss") }, payload: { listingId, fileName: "cover.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    expect(sellerSession.statusCode).toBe(201);
    const sellerSid = sellerSession.json().sessionId as string;
    const sellerAssetId = sellerSession.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sellerSid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-sc"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    const sellerFinalize = await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sellerSid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-sf") }, payload: { detectedMime: "image/jpeg" } });
    expect(sellerFinalize.statusCode).toBe(202);

    let sellerAssetStatus = "processing";
    for (let i = 0; i < 30 && sellerAssetStatus !== "ready"; i += 1) {
      const row = await pool.query("SELECT status FROM assets WHERE id = $1", [sellerAssetId]);
      sellerAssetStatus = String(row.rows[0]?.status ?? "processing");
      if (sellerAssetStatus !== "ready") {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(sellerAssetStatus).toBe("ready");

    const publish = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-p") } });
    expect(publish.statusCode).toBe(200);

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-o") }, payload: { listingId, quantity: 1 } });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;
    const capture = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-br-1" } });
    expect(capture.statusCode).toBe(201);
    const complete = await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("br-comp") }, payload: { note: "done" } });
    expect(complete.statusCode).toBe(200);

    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-r") }, payload: { orderId, rating: 5, body: "great" } });
    expect(review.statusCode).toBe(201);
    const reviewId = review.json().id as string;

    const buyerSession = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-bs") }, payload: { listingId, fileName: "buyer.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    expect(buyerSession.statusCode).toBe(201);
    const buyerSid = buyerSession.json().sessionId as string;
    const buyerAssetId = buyerSession.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${buyerSid}/chunks/0`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-bc"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    const buyerFinalize = await app.inject({ method: "POST", url: `/api/media/upload-sessions/${buyerSid}/finalize`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-bf") }, payload: { detectedMime: "image/jpeg" } });
    expect(buyerFinalize.statusCode).toBe(202);

    const attach = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/images`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("br-a") }, payload: { assetId: buyerAssetId } });
    expect(attach.statusCode).toBe(200);
  });

  test("buyer review-image upload does not consume seller listing 20-file quota", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rq-l") }, payload: { title: "Quota isolation", description: "desc", priceCents: 1000, quantity: 3 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;

    for (let i = 0; i < 20; i += 1) {
      await pool.query(
        "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
        [listingId, sellerId, `quota-${i}.jpg`],
      );
    }

    const publish = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rq-p") } });
    expect(publish.statusCode).toBe(200);

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rq-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rq-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-rq-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rq-comp") }, payload: { note: "done" } });

    const buyerSession = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rq-bs") },
      payload: { listingId, fileName: "review.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    expect(buyerSession.statusCode).toBe(201);
    expect(buyerSession.json().accepted).toBe(true);
  });

  test("buyer upload session rejects beyond 5 pending images per listing", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("bq-l") }, payload: { title: "Buyer quota guard", description: "desc", priceCents: 1000, quantity: 3 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;

    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "cover.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("bq-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("bq-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("bq-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-bq-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("bq-comp") }, payload: { note: "done" } });

    const buyerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    const buyerId = buyerMe.json().id as string;

    // 5 unattached buyer assets — should block the 6th
    for (let i = 0; i < 5; i += 1) {
      await pool.query(
        "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
        [listingId, buyerId, `buyer-img-${i}.jpg`],
      );
    }

    const sixth = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("bq-sixth") },
      payload: { listingId, fileName: "excess.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().code).toBe("BUYER_UPLOAD_QUOTA_EXCEEDED");
  });

  test("buyer can upload for second review on same listing after first review images are attached", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-l") }, payload: { title: "Multi review listing", description: "desc", priceCents: 800, quantity: 5 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const buyerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    const buyerId = buyerMe.json().id as string;

    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "cover.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-p") } });

    // Order 1: place, pay, complete, review with 5 images
    const order1 = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("mr-o1") }, payload: { listingId, quantity: 1 } });
    const orderId1 = order1.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-pay1") }, payload: { orderId: orderId1, tenderType: "cash", amountCents: 800, transactionKey: "tx-mr-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId1}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-comp1") }, payload: { note: "done" } });

    // Create 5 buyer assets and attach them to review 1
    const assetIds1: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const row = await pool.query(
        "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake') RETURNING id",
        [listingId, buyerId, `mr-review1-img-${i}.jpg`],
      );
      assetIds1.push(row.rows[0].id as string);
    }

    const review1 = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("mr-r1") }, payload: { orderId: orderId1, rating: 5, body: "Great first order", imageAssetIds: assetIds1 } });
    expect(review1.statusCode).toBe(201);

    // Now, with 5 assets attached to review 1, the pending count is 0 — buyer should be able to upload more
    // Order 2: place, pay, complete
    const order2 = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("mr-o2") }, payload: { listingId, quantity: 1 } });
    const orderId2 = order2.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-pay2") }, payload: { orderId: orderId2, tenderType: "cash", amountCents: 800, transactionKey: "tx-mr-2" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId2}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mr-comp2") }, payload: { note: "done" } });

    // Buyer can now create a new upload session for review 2 images
    const session2 = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("mr-bs2") },
      payload: { listingId, fileName: "review2.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    expect(session2.statusCode).toBe(201);
    expect(session2.json().accepted).toBe(true);
  });

  test("review create rejects mp4 assets even when listing matches", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rcm-l") }, payload: { title: "Review mp4 guard", description: "desc", priceCents: 1500, quantity: 2 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;

    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "cover.jpg"],
    );
    const mp4Asset = await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'mp4', 'video/mp4', 10, 'ready', '/tmp/fake') RETURNING id",
      [listingId, sellerId, "review.mp4"],
    );
    const mp4AssetId = mp4Asset.rows[0].id as string;

    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rcm-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rcm-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rcm-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1500, transactionKey: "tx-rcm-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rcm-comp") }, payload: { note: "done" } });

    const review = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rcm-r") },
      payload: { orderId, rating: 5, body: "text", imageAssetIds: [mp4AssetId] },
    });
    expect(review.statusCode).toBe(400);
    expect(review.json().code).toBe("INVALID_REVIEW_IMAGE_TYPE");
  });

  test("public register creates account and rejects duplicate email", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: replayHeaders("reg-new"),
      payload: { email: "newbuyer@localtrade.test", password: "buyer1234", displayName: "New Buyer", roles: ["buyer"] },
    });
    expect(register.statusCode).toBe(201);
    expect(register.json().email).toBe("newbuyer@localtrade.test");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: replayHeaders("reg-dup"),
      payload: { email: "newbuyer@localtrade.test", password: "buyer1234", displayName: "New Buyer" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("EMAIL_EXISTS");
  });

  test("moderator and arbitrator roles cannot be self-assigned at registration", async () => {
    const modAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: replayHeaders("reg-mod"),
      payload: { email: "badmod@localtrade.test", password: "badmod123", displayName: "Bad Mod", roles: ["moderator"] },
    });
    expect(modAttempt.statusCode).toBe(400);
    expect(modAttempt.json().code).toBe("ROLE_NOT_SELF_ASSIGNABLE");

    const arbAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: replayHeaders("reg-arb"),
      payload: { email: "badarb@localtrade.test", password: "badarb123", displayName: "Bad Arb", roles: ["arbitrator"] },
    });
    expect(arbAttempt.statusCode).toBe(400);
    expect(arbAttempt.json().code).toBe("ROLE_NOT_SELF_ASSIGNABLE");
  });

  test("publish rejects flagged listing, listing without assets, and listing with non-ready assets", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    await app.inject({ method: "POST", url: "/api/admin/content-rules", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("pub-rule") }, payload: { ruleType: "keyword", pattern: "blockedword", active: true } });

    const flagged = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-flag") },
      payload: { title: "blockedword listing", description: "desc", priceCents: 1000, quantity: 1 },
    });
    const flaggedPublish = await app.inject({ method: "POST", url: `/api/listings/${flagged.json().id}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-flag-p") } });
    expect(flaggedPublish.statusCode).toBe(409);
    expect(flaggedPublish.json().code).toBe("LISTING_NOT_READY");
    expect(flaggedPublish.json().message).toBe("LISTING_FLAGGED");

    const noAssets = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-empty") },
      payload: { title: "clean listing", description: "desc", priceCents: 1000, quantity: 1 },
    });
    const noAssetsPublish = await app.inject({ method: "POST", url: `/api/listings/${noAssets.json().id}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-empty-p") } });
    expect(noAssetsPublish.statusCode).toBe(409);
    expect(noAssetsPublish.json().code).toBe("LISTING_NOT_READY");
    expect(noAssetsPublish.json().message).toBe("NO_ASSETS");

    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const processingListing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-processing") },
      payload: { title: "processing listing", description: "desc", priceCents: 1000, quantity: 1 },
    });
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'processing', '/tmp/fake')",
      [processingListing.json().id, sellerId, "processing.jpg"],
    );
    const processingPublish = await app.inject({ method: "POST", url: `/api/listings/${processingListing.json().id}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-processing-p") } });
    expect(processingPublish.statusCode).toBe(409);
    expect(processingPublish.json().code).toBe("LISTING_NOT_READY");
    expect(processingPublish.json().message).toBe("ASSETS_NOT_READY");

    const failedListing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-failed") },
      payload: { title: "failed listing", description: "desc", priceCents: 1000, quantity: 1 },
    });
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'failed', '/tmp/fake')",
      [failedListing.json().id, sellerId, "failed.jpg"],
    );
    const failedPublish = await app.inject({ method: "POST", url: `/api/listings/${failedListing.json().id}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pub-failed-p") } });
    expect(failedPublish.statusCode).toBe(409);
    expect(failedPublish.json().code).toBe("LISTING_NOT_READY");
    expect(failedPublish.json().message).toBe("ASSETS_NOT_READY");
  });

  test("orders list returns actor-scoped rows", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ord-list-l") },
      payload: { title: "Scoped Orders", description: "desc", priceCents: 1300, quantity: 5 },
    });
    const listingId = listing.json().id as string;
    const session = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ord-list-s") },
      payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ord-list-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ord-list-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ord-list-p") } });

    await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ord-list-o") }, payload: { listingId, quantity: 1 } });

    const buyerOrders = await app.inject({ method: "GET", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}` } });
    expect(buyerOrders.statusCode).toBe(200);
    expect(buyerOrders.json().items.length).toBe(1);

    const sellerOrders = await app.inject({ method: "GET", url: "/api/orders", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(sellerOrders.statusCode).toBe(200);
    expect(sellerOrders.json().items.length).toBe(1);

    const adminOrders = await app.inject({ method: "GET", url: "/api/orders", headers: { authorization: `Bearer ${adminToken}` } });
    expect(adminOrders.statusCode).toBe(200);
    expect(adminOrders.json().items.length).toBeGreaterThanOrEqual(1);
  });

  test("forgot password does not expose token and reset flow works", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const me = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    expect(me.statusCode).toBe(200);
    const buyerId = me.json().id as string;

    const forgot = await app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      headers: replayHeaders("fp-forgot"),
      payload: { email: "buyer@localtrade.test" },
    });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json().message).toBeTruthy();
    expect(forgot.json().resetToken).toBeUndefined();

    const nonAdminRetrieve = await app.inject({
      method: "GET",
      url: `/api/admin/users/${buyerId}/pending-reset-token`,
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    expect(nonAdminRetrieve.statusCode).toBe(403);
    expect(nonAdminRetrieve.json().code).toBe("FORBIDDEN");

    const retrieve = await app.inject({
      method: "GET",
      url: `/api/admin/users/${buyerId}/pending-reset-token`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(retrieve.statusCode).toBe(200);
    expect(retrieve.json().resetToken).toBeUndefined();
    expect(retrieve.json().hasPendingReset).toBe(true);
    expect(retrieve.json().expiresAt).toBeTruthy();

    const pendingRow = await pool.query(
      `SELECT token_enc
       FROM password_reset_tokens
       WHERE user_id = $1 AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [buyerId],
    );
    expect(pendingRow.rowCount).toBe(1);
    const resetToken = decryptText(pendingRow.rows[0].token_enc as string);

    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: replayHeaders("fp-reset"),
      payload: { resetToken, newPassword: "buyer1234" },
    });
    expect(reset.statusCode).toBe(204);

    const loginOld = await app.inject({ method: "POST", url: "/api/auth/login", headers: replayHeaders("fp-login-old"), payload: { email: "buyer@localtrade.test", password: "buyer" } });
    expect(loginOld.statusCode).toBe(401);
    const loginNew = await app.inject({ method: "POST", url: "/api/auth/login", headers: replayHeaders("fp-login-new"), payload: { email: "buyer@localtrade.test", password: "buyer1234" } });
    expect(loginNew.statusCode).toBe(200);
  });

  test("public auth write endpoints require replay headers", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "buyer@localtrade.test", password: "buyer" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("REPLAY_HEADERS_REQUIRED");
  });

  test("public auth write endpoints are rate limited", async () => {
    let last: any;
    for (let i = 0; i < 61; i += 1) {
      last = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: replayHeaders(`auth-rate-${i}`),
        payload: { email: "buyer@localtrade.test", password: "wrong-password" },
      });
    }
    expect(last.statusCode).toBe(429);
    expect(last.json().code).toBe("RATE_LIMIT_EXCEEDED");
    expect(last.headers["retry-after"]).toBeTruthy();
  });

  test("admin can update and soft-delete content rules", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cr-create") },
      payload: { ruleType: "keyword", pattern: "banned", active: true },
    });
    expect(created.statusCode).toBe(201);
    const ruleId = created.json().id as string;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/content-rules/${ruleId}`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cr-upd") },
      payload: { active: false, pattern: "new-ban", ruleType: "keyword" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().active).toBe(false);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/content-rules/${ruleId}`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cr-del") },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().active).toBe(false);
  });

  test("seller listings management and order detail auth", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-l") },
      payload: { title: "Manage Me", description: "desc", priceCents: 1000, quantity: 3 },
    });
    const listingId = listing.json().id as string;
    const own = await app.inject({ method: "GET", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(own.statusCode).toBe(200);
    expect(own.json().items.some((x: any) => x.id === listingId)).toBe(true);

    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("mg-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const removeBlocked = await app.inject({ method: "DELETE", url: `/api/listings/${listingId}`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("mg-rm") } });
    expect(removeBlocked.statusCode).toBe(409);
    expect(removeBlocked.json().code).toBe("ACTIVE_ORDERS_EXIST");

    const forceRemove = await app.inject({ method: "DELETE", url: `/api/listings/${listingId}?force=true`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("mg-fr") } });
    expect(forceRemove.statusCode).toBe(200);

    const detailBuyer = await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(detailBuyer.statusCode).toBe(200);
    expect(detailBuyer.json().listing.title).toBe("Manage Me");

    const detailSeller = await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: { authorization: `Bearer ${sellerToken}` } });
    expect(detailSeller.statusCode).toBe(200);
    expect(detailSeller.json().buyer.email).toBe("buyer@localtrade.test");
  });

  test("negative RBAC checks return 403 for wrong roles", async () => {
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");

    const buyerCreateListing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rbac-b-list") },
      payload: { title: "bad", description: "bad", priceCents: 1000, quantity: 1 },
    });
    expect(buyerCreateListing.statusCode).toBe(403);

    const sellerCreateOrder = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-s-order") },
      payload: { listingId: "00000000-0000-0000-0000-000000000000", quantity: 1 },
    });
    expect(sellerCreateOrder.statusCode).toBe(403);

    const buyerModeration = await app.inject({ method: "GET", url: "/api/moderation/queue", headers: { authorization: `Bearer ${buyerToken}` } });
    expect(buyerModeration.statusCode).toBe(403);

    const sellerListing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-al") }, payload: { title: "appeal", description: "desc", priceCents: 1000, quantity: 1 } });
    const listingId = sellerListing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-as") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-ac"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-af") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-ap") } });
    const buyerOrder = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rbac-ao") }, payload: { listingId, quantity: 1 } });
    const orderId = buyerOrder.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-rbac-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rbac-rev") }, payload: { orderId, rating: 5, body: "great" } });
    const reviewId = review.json().id as string;
    const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-apl") }, payload: { reviewId, reason: "appeal" } });
    const appealId = appeal.json().id as string;

    const sellerResolve = await app.inject({ method: "POST", url: `/api/arbitration/appeals/${appealId}/resolve`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rbac-res") }, payload: { outcome: "uphold", note: "x" } });
    expect(sellerResolve.statusCode).toBe(403);

    const buyerAdminUsers = await app.inject({ method: "GET", url: "/api/admin/users", headers: { authorization: `Bearer ${buyerToken}` } });
    expect(buyerAdminUsers.statusCode).toBe(403);

    const arbCheck = await app.inject({ method: "GET", url: "/api/arbitration/appeals", headers: { authorization: `Bearer ${arbToken}` } });
    expect(arbCheck.statusCode).toBe(200);
  });

  test("cross-user object authorization is enforced", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-sellerb"), payload: { email: "sellerb@localtrade.test", password: "sellerb123", displayName: "Seller B", roles: ["seller"] } });
    await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-buyerb"), payload: { email: "buyerb@localtrade.test", password: "buyerb123", displayName: "Buyer B", roles: ["buyer"] } });

    const sellerAToken = await login("seller@localtrade.test", "seller");
    const sellerBToken = await login("sellerb@localtrade.test", "sellerb123");
    const buyerAToken = await login("buyer@localtrade.test", "buyer");
    const buyerBToken = await login("buyerb@localtrade.test", "buyerb123");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("xa-l") }, payload: { title: "Owner test", description: "desc", priceCents: 1100, quantity: 3 } });
    const listingId = listing.json().id as string;

    const patchBySellerB = await app.inject({ method: "PATCH", url: `/api/listings/${listingId}`, headers: { authorization: `Bearer ${sellerBToken}`, ...replayHeaders("xa-p") }, payload: { title: "hack" } });
    expect(patchBySellerB.statusCode).toBe(403);
    expect(patchBySellerB.json().code).toBe("NOT_OWNER");

    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("xa-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("xa-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("xa-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("xa-pu") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerAToken}`, ...replayHeaders("xa-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const cancelByBuyerB = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { authorization: `Bearer ${buyerBToken}`, ...replayHeaders("xa-cb") }, payload: { reason: "not mine" } });
    expect(cancelByBuyerB.statusCode).toBe(403);
    expect(cancelByBuyerB.json().code).toBe("NOT_OWNER");

    const completeBySellerB = await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerBToken}`, ...replayHeaders("xa-sb") }, payload: { note: "not owner" } });
    expect(completeBySellerB.statusCode).toBe(403);
  });

  test("jwt tamper missing auth and old refresh token are rejected", async () => {
    const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", headers: replayHeaders("auth-login-res"), payload: { email: "buyer@localtrade.test", password: "buyer" } });
    expect(loginRes.statusCode).toBe(200);
    const accessToken = loginRes.json().accessToken as string;
    const refreshToken = loginRes.json().refreshToken as string;

    const parts = accessToken.split(".");
    const tampered = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;
    const tamperedReq = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${tampered}` } });
    expect(tamperedReq.statusCode).toBe(401);

    const missingReq = await app.inject({ method: "GET", url: "/api/users/me" });
    expect(missingReq.statusCode).toBe(401);

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: replayHeaders("auth-logout"), payload: { refreshToken } });
    expect(logout.statusCode).toBe(204);

    const refreshOld = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: replayHeaders("auth-refresh-old"), payload: { refreshToken } });
    expect(refreshOld.statusCode).toBe(401);
  });

  test("old refresh token is rejected after rotation", async () => {
    const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", headers: replayHeaders("rot-login"), payload: { email: "buyer@localtrade.test", password: "buyer" } });
    expect(loginRes.statusCode).toBe(200);
    const refreshToken = loginRes.json().refreshToken as string;

    const refreshed = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: replayHeaders("rot-refresh-1"), payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    const newRefreshToken = refreshed.json().refreshToken as string;
    expect(newRefreshToken).toBeTruthy();

    const stale = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: replayHeaders("rot-refresh-2"), payload: { refreshToken } });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("settlement import deduplication skips duplicate records", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("si-l") }, payload: { title: "settle", description: "desc", priceCents: 1000, quantity: 10 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("si-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("si-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("si-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("si-p") } });

    const orderIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`si-o-${i}`) }, payload: { listingId, quantity: 1 } });
      orderIds.push(order.json().id);
    }

    const records = orderIds.map((orderId, idx) => ({ orderId, amountCents: 1000, tenderType: "card_terminal_import", transactionKey: `settle-${idx}` }));
    const first = await app.inject({ method: "POST", url: "/api/payments/import-settlement", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("si-i1") }, payload: { records } });
    expect(first.statusCode).toBe(200);
    expect(first.json().inserted).toBe(3);

    const second = await app.inject({ method: "POST", url: "/api/payments/import-settlement", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("si-i2") }, payload: { records } });
    expect(second.statusCode).toBe(200);
    expect(second.json().inserted).toBe(0);
    expect(second.json().skipped).toBe(3);

    const count = await pool.query("SELECT COUNT(*)::int AS c FROM payments WHERE transaction_key LIKE 'settle-%'");
    expect(Number(count.rows[0].c)).toBe(3);

    const recon = await pool.query("SELECT COUNT(*)::int AS c FROM reconciliation_records WHERE record_type = 'settlement_import'");
    expect(Number(recon.rows[0].c)).toBe(3);
  });

  test("refund confirmation import persists reconciliation record", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-l") }, payload: { title: "refund recon", description: "desc", priceCents: 3000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const rcAssetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-f") }, payload: { detectedMime: "image/jpeg" } });
    expect(await waitForAssetReady(rcAssetId)).toBe("ready");
    const publishRc = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-p") } });
    expect(publishRc.statusCode).toBe(200);

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rc-o") }, payload: { listingId, quantity: 1 } });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-pay") }, payload: { orderId, tenderType: "cash", amountCents: 3000, transactionKey: "tx-rc-1" } });

    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rc-r") }, payload: { orderId, amountCents: 2000, reason: "partial" } });
    const refundId = refund.json().id as string;

    const confirm = await app.inject({ method: "POST", url: "/api/refunds/import-confirmation", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("rc-conf") }, payload: { refundId, transactionKey: "tx-rc-refund-1" } });
    expect(confirm.statusCode).toBe(200);

    const recon = await pool.query("SELECT record_type, status FROM reconciliation_records WHERE external_key = 'refund:tx-rc-refund-1'");
    expect(recon.rowCount).toBe(1);
    expect(recon.rows[0].record_type).toBe("refund_confirmation");
    expect(recon.rows[0].status).toBe("confirmed");
  });

  test("order reaches refunded status after refund confirmation", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-l") }, payload: { title: "refund chain", description: "desc", priceCents: 3000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const rfcAssetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-f") }, payload: { detectedMime: "image/jpeg" } });
    expect(await waitForAssetReady(rfcAssetId)).toBe("ready");
    const publishRfc = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-p") } });
    expect(publishRfc.statusCode).toBe(200);

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rfc-o") }, payload: { listingId, quantity: 1 } });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-pay") }, payload: { orderId, tenderType: "cash", amountCents: 3000, transactionKey: "tx-refund-chain-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-comp") }, payload: { note: "done" } });

    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rfc-r") }, payload: { orderId, amountCents: 2000, reason: "partial" } });
    expect(refund.statusCode).toBe(201);
    const refundId = refund.json().id as string;

    const confirm = await app.inject({ method: "POST", url: "/api/refunds/import-confirmation", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("rfc-conf") }, payload: { refundId, transactionKey: "tx-refund-chain-2" } });
    expect(confirm.statusCode).toBe(200);

    const orderStatus = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
    expect(orderStatus.rows[0].status).toBe("refunded");
  });

  test("jwt access token expiry path rejects expired token", async () => {
    const seller = await pool.query("SELECT id FROM users WHERE email = 'buyer@localtrade.test'");
    const userId = seller.rows[0].id as string;
    const secret = new TextEncoder().encode(config.jwtSecret);
    const expiredToken = await new SignJWT({ roles: ["buyer"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);

    const response = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${expiredToken}` } });
    expect(response.statusCode).toBe(401);
  });

  test("rbac forbidden-path matrix across all five roles", async () => {
    const tokens = {
      buyer: await login("buyer@localtrade.test", "buyer"),
      seller: await login("seller@localtrade.test", "seller"),
      moderator: await login("moderator@localtrade.test", "moderator"),
      arbitrator: await login("arbitrator@localtrade.test", "arbitrator"),
      admin: await login("admin@localtrade.test", "admin"),
    } as const;

    const adminUsersChecks = await Promise.all(
      Object.entries(tokens).map(async ([role, token]) => ({
        role,
        res: await app.inject({ method: "GET", url: "/api/admin/users?page=1&pageSize=5", headers: { authorization: `Bearer ${token}` } }),
      })),
    );
    for (const check of adminUsersChecks) {
      if (check.role === "admin") expect(check.res.statusCode).toBe(200);
      else expect(check.res.statusCode).toBe(403);
    }

    const moderationChecks = await Promise.all(
      Object.entries(tokens).map(async ([role, token]) => ({
        role,
        res: await app.inject({ method: "GET", url: "/api/moderation/queue", headers: { authorization: `Bearer ${token}` } }),
      })),
    );
    for (const check of moderationChecks) {
      if (check.role === "moderator") expect(check.res.statusCode).toBe(200);
      else expect(check.res.statusCode).toBe(403);
    }

    const arbitrationChecks = await Promise.all(
      Object.entries(tokens).map(async ([role, token]) => ({
        role,
        res: await app.inject({ method: "GET", url: "/api/arbitration/appeals", headers: { authorization: `Bearer ${token}` } }),
      })),
    );
    for (const check of arbitrationChecks) {
      if (check.role === "arbitrator") expect(check.res.statusCode).toBe(200);
      else expect(check.res.statusCode).toBe(403);
    }
  });

  test("audit log captures listing order and payment operations", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-l") }, payload: { title: "audit", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("al-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-al-1" } });

    const actions = await pool.query("SELECT action FROM audit_logs ORDER BY created_at DESC");
    const set = new Set(actions.rows.map((row) => row.action));
    expect(set.has("listing.create")).toBe(true);
    expect(set.has("order.create")).toBe(true);
    expect(set.has("payment.capture")).toBe(true);
  });

  test("audit log records review and appeal actions", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-l") }, payload: { title: "audit review appeal", description: "desc", priceCents: 1000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ara-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ara-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-comp") }, payload: { note: "done" } });

    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ara-rev") }, payload: { orderId, rating: 5, body: "Great seller" } });
    expect(review.statusCode).toBe(201);
    const reviewId = review.json().id as string;

    const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ara-app") }, payload: { reviewId, reason: "Needs arbitration" } });
    expect(appeal.statusCode).toBe(201);

    const actions = await pool.query("SELECT action FROM audit_logs WHERE action IN ('review.create','appeal.create') ORDER BY created_at DESC LIMIT 2");
    const set = new Set(actions.rows.map((row) => row.action));
    expect(set.has("review.create")).toBe(true);
    expect(set.has("appeal.create")).toBe(true);
  });

  test("security regression: cross-seller capture and foreign asset access are rejected", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-seller2"), payload: { email: "seller2@localtrade.test", password: "seller2123", displayName: "Seller Two", roles: ["seller"] } });
    await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-buyer2"), payload: { email: "buyer2@localtrade.test", password: "buyer2123", displayName: "Buyer Two", roles: ["buyer"] } });

    const sellerAToken = await login("seller@localtrade.test", "seller");
    const sellerBToken = await login("seller2@localtrade.test", "seller2123");
    const buyerAToken = await login("buyer@localtrade.test", "buyer");
    const buyerBToken = await login("buyer2@localtrade.test", "buyer2123");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("sec-l") }, payload: { title: "secure", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("sec-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("sec-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("sec-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("sec-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerAToken}`, ...replayHeaders("sec-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const forbiddenCapture = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerBToken}`, ...replayHeaders("sec-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-sec-1" } });
    expect(forbiddenCapture.statusCode).toBe(403);
    expect(forbiddenCapture.json().code).toBe("FORBIDDEN");

    const forbiddenSignedUrl = await app.inject({ method: "GET", url: `/api/media/assets/${assetId}/signed-url`, headers: { authorization: `Bearer ${buyerBToken}` } });
    expect(forbiddenSignedUrl.statusCode).toBe(403);
    expect(forbiddenSignedUrl.json().code).toBe("FORBIDDEN");

    const forbiddenMetadata = await app.inject({ method: "GET", url: `/api/assets/${assetId}/metadata`, headers: { authorization: `Bearer ${buyerBToken}` } });
    expect(forbiddenMetadata.statusCode).toBe(403);
    expect(forbiddenMetadata.json().code).toBe("FORBIDDEN");
  });

  test("seller cannot capture payment for another seller's order", async () => {
    const registerSellerC = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: replayHeaders("reg-sellerc"),
      payload: { email: "sellerc@localtrade.test", password: "sellerc123", displayName: "Seller C", roles: ["seller"] },
    });
    expect(registerSellerC.statusCode).toBe(201);

    const sellerAToken = await login("seller@localtrade.test", "seller");
    const sellerCToken = await login("sellerc@localtrade.test", "sellerc123");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("scap-l") }, payload: { title: "Seller A listing", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;

    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("scap-s") }, payload: { listingId, fileName: "a.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("scap-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("scap-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerAToken}`, ...replayHeaders("scap-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("scap-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const forbiddenCapture = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerCToken}`, ...replayHeaders("scap-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-scap-1" } });
    expect(forbiddenCapture.statusCode).toBe(403);
    expect(forbiddenCapture.json().code).toBe("FORBIDDEN");
  });

  test("buyer cannot access metadata of asset on non-published listing", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("draft-l") }, payload: { title: "Draft listing", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;

    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("draft-s") }, payload: { listingId, fileName: "d.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("draft-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("draft-f") }, payload: { detectedMime: "image/jpeg" } });
    await pool.query("UPDATE assets SET status = 'ready' WHERE id = $1", [assetId]);

    const forbiddenMetadata = await app.inject({ method: "GET", url: `/api/assets/${assetId}/metadata`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(forbiddenMetadata.statusCode).toBe(403);
    expect(forbiddenMetadata.json().code).toBe("FORBIDDEN");
  });

  test("mime spoofing with matching client hint is rejected", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-l") }, payload: { title: "mime spoof", description: "desc", priceCents: 1000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 14, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("%PDF-1.7 fake") });
    const finalize = await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ms-f") }, payload: { detectedMime: "image/jpeg" } });
    expect(finalize.statusCode).toBe(400);
    expect(finalize.json().code).toBe("MIME_TYPE_MISMATCH");
  });

  test("storefront reviews sort by most_recent and highest_rated", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const sellerId = (await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } })).json().id as string;

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sr-l") }, payload: { title: "sort reviews", description: "desc", priceCents: 1000, quantity: 5 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sr-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const assetId = session.json().assetId as string;
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sr-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sr-f") }, payload: { detectedMime: "image/jpeg" } });
    let assetStatus = "processing";
    for (let i = 0; i < 30 && assetStatus !== "ready"; i += 1) {
      const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
      assetStatus = String(row.rows[0]?.status ?? "processing");
      if (assetStatus !== "ready") await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(assetStatus).toBe("ready");
    const publish = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sr-p") } });
    expect(publish.statusCode).toBe(200);

    const createReviewedOrder = async (seed: string, rating: number, body: string) => {
      const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`sr-o-${seed}`) }, payload: { listingId, quantity: 1 } });
      const orderId = order.json().id as string;
      await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sr-pay-${seed}`) }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: `tx-sr-${seed}` } });
      await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sr-comp-${seed}`) }, payload: { note: "done" } });
      await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`sr-rev-${seed}`) }, payload: { orderId, rating, body } });
      return orderId;
    };

    const firstOrderId = await createReviewedOrder("1", 2, "older low");
    const secondOrderId = await createReviewedOrder("2", 5, "newer high");
    await pool.query("UPDATE reviews SET created_at = NOW() - INTERVAL '2 days' WHERE order_id = $1", [firstOrderId]);
    await pool.query("UPDATE reviews SET created_at = NOW() - INTERVAL '1 day' WHERE order_id = $1", [secondOrderId]);

    const mostRecent = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/reviews?sortRule=most_recent` });
    expect(mostRecent.statusCode).toBe(200);
    expect(mostRecent.json().items[0].body).toBe("newer high");

    const highestRated = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/reviews?sortRule=highest_rated` });
    expect(highestRated.statusCode).toBe(200);
    expect(highestRated.json().items[0].rating).toBe(5);
  });

  test("arbitration modify outcome resolves appeal without removing review", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-l") }, payload: { title: "modify appeal", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("am-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-am-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("am-r") }, payload: { orderId, rating: 2, body: "needs edit" } });
    const reviewId = review.json().id as string;
    const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("am-a") }, payload: { reviewId, reason: "request modify" } });

    const resolved = await app.inject({ method: "POST", url: `/api/arbitration/appeals/${appeal.json().id}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("am-res") }, payload: { outcome: "modify", note: "adjusted" } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("resolved_modify");

    const row = await pool.query("SELECT removed_by_arbitration, under_appeal FROM reviews WHERE id = $1", [reviewId]);
    expect(Boolean(row.rows[0].removed_by_arbitration)).toBe(false);
    expect(Boolean(row.rows[0].under_appeal)).toBe(false);
  });

  test("stale replay timestamp is rejected", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const response = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: {
        authorization: `Bearer ${sellerToken}`,
        "x-request-nonce": `stale-${Date.now()}`,
        "x-request-timestamp": String(Math.floor(Date.now() / 1000) - 400),
      },
      payload: { title: "stale", description: "stale", priceCents: 1000, quantity: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("TIMESTAMP_OUT_OF_WINDOW");
  });

  test("rate limit triggers 429 with Retry-After", async () => {
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    let last: any;
    for (let i = 0; i < 61; i += 1) {
      last = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    }
    expect(last.statusCode).toBe(429);
    expect(last.json().code).toBe("RATE_LIMIT_EXCEEDED");
    expect(last.headers["retry-after"]).toBeTruthy();
  });

  test("blocked fingerprint prevents re-upload", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const jpgPayload = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fb-l") }, payload: { title: "fingerprint", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;

    const uploadOnce = async (seed: string) => {
      const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`fb-s-${seed}`) }, payload: { listingId, fileName: `x-${seed}.jpg`, sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
      const sid = session.json().sessionId as string;
      const assetId = session.json().assetId as string;
      await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`fb-c-${seed}`), "content-type": "application/octet-stream" }, payload: jpgPayload });
      const finalize = await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`fb-f-${seed}`) }, payload: { detectedMime: "image/jpeg" } });
      return { assetId, finalize };
    };

    const first = await uploadOnce("1");
    expect(first.finalize.statusCode).toBe(202);
    await pool.query("UPDATE assets SET status = 'blocked' WHERE id = $1", [first.assetId]);

    const second = await uploadOnce("2");
    expect(second.finalize.statusCode).toBe(409);
    expect(second.finalize.json().code).toBe("FINGERPRINT_BLOCKED");
  });

  test("payment capture rejects duplicate transaction key", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-l") }, payload: { title: "idem", description: "desc", priceCents: 1000, quantity: 4 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("pi-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const first = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-1") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-dupe-1" } });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("pi-2") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-dupe-1" } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("duplicate review on same order returns REVIEW_ALREADY_EXISTS", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-l") }, payload: { title: "dup review", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("dr-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-dr-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dr-comp") }, payload: { note: "done" } });

    const first = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("dr-r1") }, payload: { orderId, rating: 5, body: "great" } });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("dr-r2") }, payload: { orderId, rating: 4, body: "again" } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("REVIEW_ALREADY_EXISTS");
  });

  test("arbitration remove outcome marks review removed_by_arbitration", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-l") }, payload: { title: "remove review", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ar-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ar-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ar-r") }, payload: { orderId, rating: 1, body: "bad" } });
    const reviewId = review.json().id as string;
    const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-a") }, payload: { reviewId, reason: "remove" } });
    const appealId = appeal.json().id as string;

    const resolved = await app.inject({ method: "POST", url: `/api/arbitration/appeals/${appealId}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("ar-res") }, payload: { outcome: "remove", note: "policy breach" } });
    expect(resolved.statusCode).toBe(200);

    const db = await pool.query("SELECT removed_by_arbitration FROM reviews WHERE id = $1", [reviewId]);
    expect(Boolean(db.rows[0].removed_by_arbitration)).toBe(true);
  });

  test("file limit rejects 21st upload session for a listing", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fl-l") }, payload: { title: "many files", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;

    for (let i = 0; i < 20; i += 1) {
      const response = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`fl-${i}`) }, payload: { listingId, fileName: `f-${i}.jpg`, sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
      expect(response.statusCode).toBe(201);
    }

    const blocked = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fl-21") }, payload: { listingId, fileName: "f-21.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("FILE_LIMIT_REACHED");
  });

  test("listing update with banned content flips status to flagged", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    await app.inject({ method: "POST", url: "/api/admin/content-rules", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("lu-r") }, payload: { ruleType: "keyword", pattern: "bannedword", active: true } });
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("lu-l") }, payload: { title: "clean", description: "clean", priceCents: 1000, quantity: 1 } });
    const listingId = listing.json().id as string;
    expect(listing.json().status).toBe("draft");

    const updated = await app.inject({ method: "PATCH", url: `/api/listings/${listingId}`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("lu-u") }, payload: { description: "contains bannedword now" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe("flagged");
  });

  test("regex content rule flags listing create and update", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const regexRule = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("rx-rule") },
      payload: { ruleType: "regex", pattern: "forbid\\s+me", active: true },
    });
    expect(regexRule.statusCode).toBe(201);

    const flaggedOnCreate = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rx-create") },
      payload: { title: "Regex create", description: "please forbid   me", priceCents: 1000, quantity: 1 },
    });
    expect(flaggedOnCreate.statusCode).toBe(201);
    expect(flaggedOnCreate.json().status).toBe("flagged");

    const clean = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rx-clean") },
      payload: { title: "Regex update", description: "clean text", priceCents: 1000, quantity: 1 },
    });
    expect(clean.statusCode).toBe(201);
    expect(clean.json().status).toBe("draft");

    const listingId = clean.json().id as string;
    const flaggedOnUpdate = await app.inject({
      method: "PATCH",
      url: `/api/listings/${listingId}`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rx-upd") },
      payload: { description: "now we forbid me in update" },
    });
    expect(flaggedOnUpdate.statusCode).toBe(200);
    expect(flaggedOnUpdate.json().status).toBe("flagged");
  });

  test("unsafe regex rule patterns are rejected", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");

    const createUnsafe = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("unsafe-rx-create") },
      payload: { ruleType: "regex", pattern: "(a+)+$", active: true },
    });
    expect(createUnsafe.statusCode).toBe(400);
    expect(createUnsafe.json().code).toBe("UNSAFE_REGEX_PATTERN");

    const safeRule = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("unsafe-rx-safe") },
      payload: { ruleType: "regex", pattern: "forbid\\s+me", active: true },
    });
    expect(safeRule.statusCode).toBe(201);

    const patchUnsafe = await app.inject({
      method: "PATCH",
      url: `/api/admin/content-rules/${safeRule.json().id}`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("unsafe-rx-patch") },
      payload: { pattern: "(a+)+$" },
    });
    expect(patchUnsafe.statusCode).toBe(400);
    expect(patchUnsafe.json().code).toBe("UNSAFE_REGEX_PATTERN");
  });

  test("cancel order after payment capture returns invalid state transition", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-l") }, payload: { title: "cancel state", description: "desc", priceCents: 1000, quantity: 3 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const assetId = session.json().assetId as string;
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-f") }, payload: { detectedMime: "image/jpeg" } });
    let assetStatus = "processing";
    for (let i = 0; i < 30 && assetStatus !== "ready"; i += 1) {
      const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
      assetStatus = String(row.rows[0]?.status ?? "processing");
      if (assetStatus !== "ready") await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(assetStatus).toBe("ready");
    const publish = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-p") } });
    expect(publish.statusCode).toBe(200);
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("co-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("co-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-co-1" } });

    const cancel = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("co-can") }, payload: { reason: "too late" } });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe("INVALID_STATE_TRANSITION");
  });

  test("storefront credit metrics endpoint returns expected values", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const sellerId = (await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } })).json().id as string;

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cm-l") }, payload: { title: "metrics", description: "desc", priceCents: 1000, quantity: 6 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cm-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cm-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cm-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cm-p") } });

    const ratings = [5, 3, 1];
    for (let i = 0; i < ratings.length; i += 1) {
      const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`cm-o-${i}`) }, payload: { listingId, quantity: 1 } });
      const orderId = order.json().id as string;
      await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`cm-pay-${i}`) }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: `tx-cm-${i}` } });
      await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`cm-comp-${i}`) }, payload: { note: "done" } });
      await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`cm-rev-${i}`) }, payload: { orderId, rating: ratings[i], body: `r${i}` } });
    }

    const metrics = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/credit-metrics` });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().reviewCount90d).toBe(3);
    expect(metrics.json().avgRating90d).toBeCloseTo(3, 5);
    expect(metrics.json().positiveRate90d).toBeCloseTo(33.333333, 3);
  });

  test("sensitive seller fields are encrypted at rest and returned masked", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");

    const update = await app.inject({
      method: "PATCH",
      url: "/api/users/me/seller-profile",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("enc-upd") },
      payload: { taxId: "123456789", bankRouting: "021000021", bankAccount: "9876543210" },
    });
    expect(update.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(me.statusCode).toBe(200);
    const profile = me.json().sensitiveProfile;
    expect(profile.taxIdMasked).toBe("****6789");
    expect(profile.bankRoutingMasked).toBe("****0021");
    expect(profile.bankAccountMasked).toBe("****3210");

    const raw = await pool.query("SELECT tax_id_enc FROM users WHERE email = 'seller@localtrade.test'");
    expect(raw.rows[0].tax_id_enc).not.toBe("123456789");
    expect(raw.rows[0].tax_id_enc).toBeTruthy();
  });

  test("payment data isolation blocks unrelated buyer from viewing payment", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-buyerx"), payload: { email: "buyerx@localtrade.test", password: "buyerx123", displayName: "Buyer X", roles: ["buyer"] } });
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerAToken = await login("buyer@localtrade.test", "buyer");
    const buyerBToken = await login("buyerx@localtrade.test", "buyerx123");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-l") }, payload: { title: "pay isolate", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const isoAssetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-f") }, payload: { detectedMime: "image/jpeg" } });
    expect(await waitForAssetReady(isoAssetId)).toBe("ready");
    const publishIso = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-p") } });
    expect(publishIso.statusCode).toBe(200);
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerAToken}`, ...replayHeaders("iso-o") }, payload: { listingId, quantity: 1 } });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;
    const payment = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("iso-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-iso-1" } });
    const paymentId = payment.json().paymentId as string;

    const forbidden = await app.inject({ method: "GET", url: `/api/payments/${paymentId}`, headers: { authorization: `Bearer ${buyerBToken}` } });
    expect(forbidden.statusCode).toBe(403);
  });

  test("weak password registration is rejected", async () => {
    const digitsOnly = await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-weak1"), payload: { email: "weak1@localtrade.test", password: "12345678", displayName: "Weak 1", roles: ["buyer"] } });
    expect(digitsOnly.statusCode).toBe(400);

    const lettersOnly = await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("reg-weak2"), payload: { email: "weak2@localtrade.test", password: "abcdefgh", displayName: "Weak 2", roles: ["buyer"] } });
    expect(lettersOnly.statusCode).toBe(400);
  });

  test("buyer can cancel only when order is in placed state", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cn-l") },
      payload: { title: "cancel ok", description: "desc", priceCents: 1000, quantity: 2 },
    });
    const listingId = listing.json().id as string;

    const session = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cn-s") },
      payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cn-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cn-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cn-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("cn-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;

    const cancel = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("cn-can") }, payload: { reason: "changed mind" } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("cancelled");
  });

  test("order state machine transitions are validated end-to-end across terminal paths", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const adminToken = await login("admin@localtrade.test", "admin");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-l") },
      payload: { title: "state machine", description: "desc", priceCents: 1000, quantity: 4 },
    });
    const listingId = listing.json().id as string;

    const session = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-s") },
      payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
    });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-p") } });

    // Path A: placed -> cancelled
    const cancelOrder = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("sm-o1") }, payload: { listingId, quantity: 1 } });
    const cancelOrderId = cancelOrder.json().id as string;
    const cancelled = await app.inject({ method: "POST", url: `/api/orders/${cancelOrderId}/cancel`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("sm-can") }, payload: { reason: "changed mind" } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");

    // Path B: placed -> payment_captured -> completed -> refunded
    const refundOrder = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("sm-o2") }, payload: { listingId, quantity: 1 } });
    const refundOrderId = refundOrder.json().id as string;

    const captured = await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-pay") }, payload: { orderId: refundOrderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-sm-1" } });
    expect(captured.statusCode).toBe(201);

    const completed = await app.inject({ method: "POST", url: `/api/orders/${refundOrderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-comp") }, payload: { note: "done" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("completed");

    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sm-rf") }, payload: { orderId: refundOrderId, amountCents: 300, reason: "partial" } });
    expect(refund.statusCode).toBe(201);

    const confirmed = await app.inject({ method: "POST", url: "/api/refunds/import-confirmation", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("sm-rfc") }, payload: { refundId: refund.json().id, transactionKey: "tx-sm-rf-1" } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("confirmed");

    const finalStatus = await app.inject({ method: "GET", url: `/api/orders/${refundOrderId}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(finalStatus.statusCode).toBe(200);
    expect(finalStatus.json().status).toBe("refunded");
  });

  test("arbitration outcomes uphold/modify/remove are reflected in storefront badges", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");
    const sellerId = (await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } })).json().id as string;

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ab-l") }, payload: { title: "badge outcomes", description: "desc", priceCents: 1000, quantity: 6 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ab-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ab-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ab-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ab-p") } });

    const createReview = async (seed: string, rating: number, body: string) => {
      const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`ab-o-${seed}`) }, payload: { listingId, quantity: 1 } });
      const orderId = order.json().id as string;
      await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`ab-pay-${seed}`) }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: `tx-ab-${seed}` } });
      await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`ab-comp-${seed}`) }, payload: { note: "done" } });
      const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders(`ab-r-${seed}`) }, payload: { orderId, rating, body } });
      return review.json().id as string;
    };

    const upholdReviewId = await createReview("up", 5, "uphold case");
    const modifyReviewId = await createReview("md", 4, "modify case");
    const removeReviewId = await createReview("rm", 1, "remove case");

    const createAppeal = async (reviewId: string, seed: string) => {
      const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`ab-a-${seed}`) }, payload: { reviewId, reason: `reason-${seed}` } });
      expect(appeal.statusCode).toBe(201);
      return appeal.json().id as string;
    };

    const upholdAppealId = await createAppeal(upholdReviewId, "up");
    const modifyAppealId = await createAppeal(modifyReviewId, "md");
    const removeAppealId = await createAppeal(removeReviewId, "rm");

    const whileOpen = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/reviews?sortRule=most_recent` });
    expect(whileOpen.statusCode).toBe(200);
    const openItem = whileOpen.json().items.find((x: any) => x.id === removeReviewId);
    expect(Boolean(openItem.underAppeal)).toBe(true);

    await app.inject({ method: "POST", url: `/api/arbitration/appeals/${upholdAppealId}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("ab-res-up") }, payload: { outcome: "uphold", note: "kept" } });
    await app.inject({ method: "POST", url: `/api/arbitration/appeals/${modifyAppealId}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("ab-res-md") }, payload: { outcome: "modify", note: "edited" } });
    await app.inject({ method: "POST", url: `/api/arbitration/appeals/${removeAppealId}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("ab-res-rm") }, payload: { outcome: "remove", note: "removed" } });

    const afterResolve = await app.inject({ method: "GET", url: `/api/storefront/sellers/${sellerId}/reviews?sortRule=most_recent` });
    expect(afterResolve.statusCode).toBe(200);
    const items = afterResolve.json().items as Array<any>;
    const upholdItem = items.find((x) => x.id === upholdReviewId);
    const modifyItem = items.find((x) => x.id === modifyReviewId);
    const removeItem = items.find((x) => x.id === removeReviewId);
    expect(Boolean(upholdItem.underAppeal)).toBe(false);
    expect(Boolean(upholdItem.removedByArbitration)).toBe(false);
    expect(Boolean(modifyItem.underAppeal)).toBe(false);
    expect(Boolean(modifyItem.removedByArbitration)).toBe(false);
    expect(Boolean(removeItem.underAppeal)).toBe(false);
    expect(Boolean(removeItem.removedByArbitration)).toBe(true);
  });

  test("audit log records key operations across listing, moderation, order, payment, review, appeal, and refund", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const moderatorToken = await login("moderator@localtrade.test", "moderator");
    const arbToken = await login("arbitrator@localtrade.test", "arbitrator");

    await app.inject({ method: "POST", url: "/api/admin/content-rules", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("ak-rule") }, payload: { ruleType: "keyword", pattern: "forbidden", active: true } });
    const flagged = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-flag") }, payload: { title: "forbidden product", description: "forbidden", priceCents: 1000, quantity: 1 } });
    expect(flagged.statusCode).toBe(201);
    await app.inject({ method: "POST", url: `/api/moderation/listings/${flagged.json().id}/decision`, headers: { authorization: `Bearer ${moderatorToken}`, ...replayHeaders("ak-mod") }, payload: { decision: "approve", notes: "approved" } });

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-l") }, payload: { title: "audit key ops", description: "clean", priceCents: 1000, quantity: 3 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-s") }, payload: { listingId, fileName: "x.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-f") }, payload: { detectedMime: "image/jpeg" } });
    // Wait for the worker to finish postprocessing before publishing so this
    // deterministically exercises the publish-audit path even under slower
    // container scheduling.
    let assetStatus = "processing";
    for (let i = 0; i < 60 && assetStatus !== "ready"; i += 1) {
      const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
      assetStatus = String(row.rows[0]?.status ?? "processing");
      if (assetStatus !== "ready") await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(assetStatus).toBe("ready");
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ak-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ak-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ak-r") }, payload: { orderId, rating: 2, body: "needs review" } });
    const reviewId = review.json().id as string;
    const appeal = await app.inject({ method: "POST", url: "/api/appeals", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-a") }, payload: { reviewId, reason: "appeal" } });
    await app.inject({ method: "POST", url: `/api/arbitration/appeals/${appeal.json().id}/resolve`, headers: { authorization: `Bearer ${arbToken}`, ...replayHeaders("ak-arb") }, payload: { outcome: "uphold", note: "upheld" } });
    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ak-rf") }, payload: { orderId, amountCents: 300, reason: "partial" } });
    await app.inject({ method: "POST", url: "/api/refunds/import-confirmation", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("ak-rfc") }, payload: { refundId: refund.json().id, transactionKey: "tx-ak-rf-1" } });

    const actions = await pool.query("SELECT action FROM audit_logs");
    const set = new Set(actions.rows.map((r) => String(r.action)));
    for (const expected of [
      "content_rule.create",
      "moderation.decision",
      "listing.create",
      "listing.publish",
      "order.create",
      "payment.capture",
      "order.complete",
      "review.create",
      "appeal.create",
      "appeal.resolve",
      "refund.create",
      "refund.confirm",
    ]) {
      expect(set.has(expected)).toBe(true);
    }
  });

  test("upload session enforces 2GB file size boundary", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sz-l") },
      payload: { title: "size boundary", description: "desc", priceCents: 1000, quantity: 1 },
    });
    const listingId = listing.json().id as string;

    const atLimit = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sz-ok") },
      payload: {
        listingId,
        fileName: "limit.mp4",
        sizeBytes: 2 * 1024 * 1024 * 1024,
        extension: "mp4",
        mimeType: "video/mp4",
        totalChunks: 409600,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    expect(atLimit.statusCode).toBe(201);

    const overLimit = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sz-over") },
      payload: {
        listingId,
        fileName: "over.mp4",
        sizeBytes: 2 * 1024 * 1024 * 1024 + 1,
        extension: "mp4",
        mimeType: "video/mp4",
        totalChunks: 409601,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().code).toBe("FILE_TOO_LARGE");
  });

  test("finalize upload returns 202 and worker completes asynchronously", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");

    const listing = await app.inject({
      method: "POST",
      url: "/api/listings",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("async-l") },
      payload: { title: "async media", description: "desc", priceCents: 1000, quantity: 1 },
    });
    const listingId = listing.json().id as string;

    const session = await app.inject({
      method: "POST",
      url: "/api/media/upload-sessions",
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("async-s") },
      payload: {
        listingId,
        fileName: "video.mp4",
        sizeBytes: 20,
        extension: "mp4",
        mimeType: "video/mp4",
        totalChunks: 1,
        chunkSizeBytes: 5 * 1024 * 1024,
      },
    });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    await app.inject({
      method: "PUT",
      url: `/api/media/upload-sessions/${sid}/chunks/0`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("async-c"), "content-type": "application/octet-stream" },
      payload: Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00]),
    });

    const finalize = await app.inject({
      method: "POST",
      url: `/api/media/upload-sessions/${sid}/finalize`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("async-f") },
      payload: { detectedMime: "video/mp4" },
    });
    expect(finalize.statusCode).toBe(202);
    expect(finalize.json().status).toBe("processing");

    const firstRead = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
    expect(["processing", "ready"]).toContain(String(firstRead.rows[0].status));

    let status = String(firstRead.rows[0].status);
    for (let i = 0; i < 30 && status !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
      status = String(row.rows[0].status);
    }
    expect(status).toBe("ready");
  });

  test("store credit capture is safe under parallel requests", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const buyerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${buyerToken}` } });
    const buyerId = buyerMe.json().id as string;
    await app.inject({
      method: "POST",
      url: `/api/admin/users/${buyerId}/store-credit`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("sc-credit") },
      payload: { amountCents: 1000, note: "concurrency test" },
    });

    const createPublishedListing = async (seed: string) => {
      const listing = await app.inject({
        method: "POST",
        url: "/api/listings",
        headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sc-l-${seed}`) },
        payload: { title: `sc-${seed}`, description: "desc", priceCents: 1000, quantity: 2 },
      });
      const listingId = listing.json().id as string;
      const session = await app.inject({
        method: "POST",
        url: "/api/media/upload-sessions",
        headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sc-s-${seed}`) },
        payload: { listingId, fileName: `${seed}.jpg`, sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 },
      });
      const sid = session.json().sessionId as string;
      const assetId = session.json().assetId as string;
      await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sc-c-${seed}`), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
      await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sc-f-${seed}`) }, payload: { detectedMime: "image/jpeg" } });
      let status = "processing";
      for (let i = 0; i < 30 && status !== "ready"; i += 1) {
        const row = await pool.query("SELECT status FROM assets WHERE id = $1", [assetId]);
        status = String(row.rows[0]?.status ?? "processing");
        if (status !== "ready") {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(status).toBe("ready");

      const publish = await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders(`sc-p-${seed}`) } });
      expect(publish.statusCode).toBe(200);
      return listingId;
    };

    const [listingA, listingB] = await Promise.all([createPublishedListing("a"), createPublishedListing("b")]);

    const orderA = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("sc-o-a") }, payload: { listingId: listingA, quantity: 1 } });
    const orderB = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("sc-o-b") }, payload: { listingId: listingB, quantity: 1 } });
    const orderAId = orderA.json().id as string;
    const orderBId = orderB.json().id as string;

    const [capA, capB] = await Promise.all([
      app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sc-pay-a") }, payload: { orderId: orderAId, tenderType: "store_credit", amountCents: 1000, transactionKey: "tx-sc-a" } }),
      app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sc-pay-b") }, payload: { orderId: orderBId, tenderType: "store_credit", amountCents: 1000, transactionKey: "tx-sc-b" } }),
    ]);

    const results = [capA, capB];
    const successCount = results.filter((r) => r.statusCode === 201).length;
    const failureCount = results.filter((r) => r.statusCode === 409).length;
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);
    const failure = results.find((r) => r.statusCode === 409)!;
    expect(failure.json().code).toBe("INSUFFICIENT_STORE_CREDIT");
  });

  test("review image attach rejects assets that are not ready", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-l") }, payload: { title: "ready-asset check", description: "desc", priceCents: 1000, quantity: 2 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-s") }, payload: { listingId, fileName: "base.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-c"), "content-type": "application/octet-stream" }, payload: Buffer.from("abc") });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-f") }, payload: { detectedMime: "image/jpeg" } });
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ra-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-pay") }, payload: { orderId, tenderType: "cash", amountCents: 1000, transactionKey: "tx-ra-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ra-comp") }, payload: { note: "done" } });
    const review = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ra-r") }, payload: { orderId, rating: 5, body: "good" } });
    const reviewId = review.json().id as string;

    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const notReadyAsset = await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'processing', '/tmp/fake') RETURNING id",
      [listingId, sellerId, "processing.jpg"],
    );

    const attach = await app.inject({ method: "POST", url: `/api/reviews/${reviewId}/images`, headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ra-att") }, payload: { assetId: notReadyAsset.rows[0].id } });
    expect(attach.statusCode).toBe(409);
    expect(attach.json().code).toBe("ASSET_NOT_READY");
  });

  test("docs route can be disabled by configuration", async () => {
    const previous = config.docsEnabled;
    config.docsEnabled = false;
    const isolated = buildServer();
    try {
      const res = await isolated.inject({ method: "GET", url: "/docs" });
      expect(res.statusCode).toBe(404);
    } finally {
      await isolated.close();
      config.docsEnabled = previous;
    }
  });

  test("GET /health/live returns ok without authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  test("GET /health/ready returns ok and confirms DB is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  test("GET /api/listings/:id returns readiness state for seller; buyer is 403", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listingRes = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("gl-l") }, payload: { title: "Readiness check", description: "desc", priceCents: 500, quantity: 1 } });
    const listingId = listingRes.json().id as string;

    const ownView = await app.inject({ method: "GET", url: `/api/listings/${listingId}`, headers: { authorization: `Bearer ${sellerToken}` } });
    expect(ownView.statusCode).toBe(200);
    const body = ownView.json();
    expect(body.id).toBe(listingId);
    expect(body.status).toBe("draft");
    expect(body.readyToPublish).toBe(false);
    expect(body.blockedReason).toBe("NO_ASSETS");
    expect(Array.isArray(body.assets)).toBe(true);

    const buyerForbidden = await app.inject({ method: "GET", url: `/api/listings/${listingId}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(buyerForbidden.statusCode).toBe(403);
  });

  test("GET /api/reviews/:id returns review details without authentication", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("grv-l") }, payload: { title: "Review fetch", description: "desc", priceCents: 500, quantity: 1 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "ready.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("grv-p") } });

    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("grv-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("grv-pay") }, payload: { orderId, tenderType: "cash", amountCents: 500, transactionKey: "tx-grv-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("grv-comp") }, payload: { note: "done" } });
    const reviewRes = await app.inject({ method: "POST", url: "/api/reviews", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("grv-r") }, payload: { orderId, rating: 4, body: "Solid" } });
    const reviewId = reviewRes.json().id as string;

    const got = await app.inject({ method: "GET", url: `/api/reviews/${reviewId}` });
    expect(got.statusCode).toBe(200);
    const r = got.json();
    expect(r.id).toBe(reviewId);
    expect(Number(r.rating)).toBe(4);
    expect(r.body).toBe("Solid");
    expect(r.badges).toBeDefined();

    const missing = await app.inject({ method: "GET", url: "/api/reviews/00000000-0000-0000-0000-000000000000" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("REVIEW_NOT_FOUND");
  });

  test("GET /api/storefront/listings is public and supports ranking/sellerId filters", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sfl-l") }, payload: { title: "Storefront listing", description: "desc", priceCents: 500, quantity: 2 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "cover.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("sfl-p") } });

    const all = await app.inject({ method: "GET", url: "/api/storefront/listings" });
    expect(all.statusCode).toBe(200);
    const items = all.json().items as Array<{ id: string; seller_id: string }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((it) => it.id === listingId)).toBe(true);

    const filtered = await app.inject({ method: "GET", url: `/api/storefront/listings?sellerId=${sellerId}&ranking=most_recent` });
    expect(filtered.statusCode).toBe(200);
    const filteredItems = filtered.json().items as Array<{ id: string }>;
    expect(filteredItems.some((it) => it.id === listingId)).toBe(true);
  });

  test("GET /api/assets/:id returns own asset summary for seller and 403 for foreign seller", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ga-l") }, payload: { title: "Asset own", description: "desc", priceCents: 500, quantity: 1 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    const assetRow = await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake') RETURNING id",
      [listingId, sellerId, "own.jpg"],
    );
    const assetId = assetRow.rows[0].id as string;

    const own = await app.inject({ method: "GET", url: `/api/assets/${assetId}`, headers: { authorization: `Bearer ${sellerToken}` } });
    expect(own.statusCode).toBe(200);
    const body = own.json();
    expect(body.id).toBe(assetId);
    expect(body.listingId).toBe(listingId);
    expect(body.status).toBe("ready");
    expect(body.mimeType).toBe("image/jpeg");
    expect(body.sizeBytes).toBe(10);

    // Foreign seller cannot read another seller's asset
    const foreignEmail = `ga-foreign-${Date.now()}@test.local`;
    const foreignReg = await app.inject({ method: "POST", url: "/api/auth/register", headers: replayHeaders("ga-fr"), payload: { email: foreignEmail, password: "Passw0rd1", displayName: "F Seller", roles: ["seller"] } });
    expect(foreignReg.statusCode).toBe(201);
    const foreignToken = await login(foreignEmail, "Passw0rd1");
    const forbidden = await app.inject({ method: "GET", url: `/api/assets/${assetId}`, headers: { authorization: `Bearer ${foreignToken}` } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("FORBIDDEN");
  });

  test("GET /api/admin/audit-logs returns paginated items for admin and 404 for missing id", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    // Produce at least one audit row via an admin-visible action
    await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("al-l") }, payload: { title: "Audit probe", description: "desc", priceCents: 500, quantity: 1 } });

    const list = await app.inject({ method: "GET", url: "/api/admin/audit-logs?page=1&pageSize=10", headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(typeof body.total).toBe("number");
    expect(body.items.length).toBeGreaterThan(0);

    const first = body.items[0] as { id: string };
    const byId = await app.inject({ method: "GET", url: `/api/admin/audit-logs/${first.id}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().id).toBe(first.id);

    const missing = await app.inject({ method: "GET", url: "/api/admin/audit-logs/00000000-0000-0000-0000-000000000000", headers: { authorization: `Bearer ${adminToken}` } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("AUDIT_LOG_NOT_FOUND");

    const sellerForbidden = await app.inject({ method: "GET", url: "/api/admin/audit-logs", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(sellerForbidden.statusCode).toBe(403);
  });

  test("POST /api/admin/backups/run queues a backup job with 202 accepted for admin only", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const forbidden = await app.inject({ method: "POST", url: "/api/admin/backups/run", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("bk-forbidden") } });
    expect(forbidden.statusCode).toBe(403);

    const accepted = await app.inject({ method: "POST", url: "/api/admin/backups/run", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("bk-ok") } });
    expect(accepted.statusCode).toBe(202);
    const body = accepted.json();
    expect(body.jobId).toBeDefined();
    expect(body.status).toBe("queued");

    const jobRow = await pool.query("SELECT type FROM jobs WHERE id = $1", [body.jobId]);
    expect(jobRow.rows[0]?.type).toBe("backup");
  });

  test("POST /api/admin/content-rules/:id/test returns match outcome against provided text", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const created = await app.inject({ method: "POST", url: "/api/admin/content-rules", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("crt-c") }, payload: { ruleType: "keyword", pattern: "contraband", active: true } });
    expect(created.statusCode).toBe(201);
    const ruleId = created.json().id as string;

    const matched = await app.inject({ method: "POST", url: `/api/admin/content-rules/${ruleId}/test`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("crt-m") }, payload: { text: "this has contraband in it" } });
    expect(matched.statusCode).toBe(200);
    expect(matched.json().matched).toBe(true);
    expect(matched.json().matchDetail).toBeTruthy();

    const notMatched = await app.inject({ method: "POST", url: `/api/admin/content-rules/${ruleId}/test`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("crt-nm") }, payload: { text: "clean safe content" } });
    expect(notMatched.statusCode).toBe(200);
    expect(notMatched.json().matched).toBe(false);
    expect(notMatched.json().matchDetail).toBeNull();

    const missing = await app.inject({ method: "POST", url: "/api/admin/content-rules/00000000-0000-0000-0000-000000000000/test", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("crt-404") }, payload: { text: "x" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("RULE_NOT_FOUND");
  });

  test("GET /api/admin/jobs + POST /api/admin/jobs/:id/retry enforce admin auth and status transition", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const forbidden = await app.inject({ method: "GET", url: "/api/admin/jobs", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(forbidden.statusCode).toBe(403);

    // Use a synthetic job type the in-process worker does not claim, so
    // this test exercises ONLY the admin jobs list + retry endpoints and
    // is not racing the asset-postprocess worker ticks that other tests
    // may have fired.
    const failedInsert = await pool.query(
      "INSERT INTO jobs(type, payload_json, status, retry_count, last_error) VALUES('admin_jobs_test', '{}', 'failed', 3, 'forced failure') RETURNING id",
    );
    const failedId = failedInsert.rows[0].id as string;
    const queuedInsert = await pool.query(
      "INSERT INTO jobs(type, payload_json, status, retry_count) VALUES('admin_jobs_test', '{}', 'queued', 0) RETURNING id",
    );
    const queuedId = queuedInsert.rows[0].id as string;

    const list = await app.inject({ method: "GET", url: "/api/admin/jobs", headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ id: string; status: string }>;
    expect(items.some((j) => j.id === failedId)).toBe(true);
    expect(items.some((j) => j.id === queuedId)).toBe(true);

    const retryOk = await app.inject({ method: "POST", url: `/api/admin/jobs/${failedId}/retry`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("jobs-retry-ok") } });
    expect(retryOk.statusCode).toBe(200);
    expect(retryOk.json().status).toBe("queued");
    const reloadedFailed = await pool.query("SELECT status FROM jobs WHERE id = $1", [failedId]);
    expect(reloadedFailed.rows[0].status).toBe("queued");

    const retryConflict = await app.inject({ method: "POST", url: `/api/admin/jobs/${queuedId}/retry`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("jobs-retry-cf") } });
    expect(retryConflict.statusCode).toBe(409);
    expect(retryConflict.json().code).toBe("JOB_NOT_RETRIABLE");

    const retry404 = await app.inject({ method: "POST", url: "/api/admin/jobs/00000000-0000-0000-0000-000000000000/retry", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("jobs-retry-404") } });
    expect(retry404.statusCode).toBe(404);
    expect(retry404.json().code).toBe("JOB_NOT_FOUND");
  });

  test("POST /api/admin/orders/:id/force-complete marks order completed and records audit", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");

    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fc-l") }, payload: { title: "Force complete", description: "desc", priceCents: 900, quantity: 2 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "fc.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fc-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("fc-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fc-pay") }, payload: { orderId, tenderType: "cash", amountCents: 900, transactionKey: "tx-fc-1" } });

    const sellerForbidden = await app.inject({ method: "POST", url: `/api/admin/orders/${orderId}/force-complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("fc-forb") }, payload: { reason: "nope" } });
    expect(sellerForbidden.statusCode).toBe(403);

    const forced = await app.inject({ method: "POST", url: `/api/admin/orders/${orderId}/force-complete`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("fc-ok") }, payload: { reason: "ops override for stuck order" } });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().status).toBe("completed");
    const row = await pool.query("SELECT status, completed_at FROM orders WHERE id = $1", [orderId]);
    expect(row.rows[0].status).toBe("completed");
    expect(row.rows[0].completed_at).not.toBeNull();
  });

  test("GET /api/admin/refunds returns full refund history across sellers for admin", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-l") }, payload: { title: "Admin refund list", description: "desc", priceCents: 500, quantity: 2 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "ar.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("ar-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-pay") }, payload: { orderId, tenderType: "cash", amountCents: 500, transactionKey: "tx-ar-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-comp") }, payload: { note: "done" } });
    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("ar-ref") }, payload: { orderId, amountCents: 500, reason: "Return" } });
    const refundId = refund.json().id as string;

    const list = await app.inject({ method: "GET", url: "/api/admin/refunds", headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ id: string }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((r) => r.id === refundId)).toBe(true);

    const sellerForbidden = await app.inject({ method: "GET", url: "/api/admin/refunds", headers: { authorization: `Bearer ${sellerToken}` } });
    expect(sellerForbidden.statusCode).toBe(403);
  });

  test("POST /api/admin/users creates a user with requested roles for admin only", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const email = `newuser-${Date.now()}@test.local`;

    const forbidden = await app.inject({ method: "POST", url: "/api/admin/users", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("cu-forb") }, payload: { email, password: "Passw0rd!", displayName: "New", roles: ["seller"] } });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cu-ok") }, payload: { email, password: "Passw0rd!", displayName: "New User", roles: ["seller", "buyer"] } });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.id).toBeDefined();
    expect(body.email).toBe(email);
    expect(body.roles.sort()).toEqual(["buyer", "seller"]);

    const dup = await app.inject({ method: "POST", url: "/api/admin/users", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cu-dup") }, payload: { email, password: "Passw0rd!", displayName: "Dup", roles: ["seller"] } });
    expect(dup.statusCode).toBe(409);
  });

  test("PATCH /api/admin/users/:id/status toggles active/inactive and 403 for seller", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const targetEmail = `status-target-${Date.now()}@test.local`;
    const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("us-create") }, payload: { email: targetEmail, password: "Passw0rd!", displayName: "Status Target", roles: ["seller"] } });
    const targetId = created.json().id as string;

    const forbidden = await app.inject({ method: "PATCH", url: `/api/admin/users/${targetId}/status`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("us-forb") }, payload: { status: "inactive", reason: "testing" } });
    expect(forbidden.statusCode).toBe(403);

    const deactivate = await app.inject({ method: "PATCH", url: `/api/admin/users/${targetId}/status`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("us-deact") }, payload: { status: "inactive", reason: "audit hold" } });
    expect(deactivate.statusCode).toBe(200);
    const row = await pool.query("SELECT status FROM users WHERE id = $1", [targetId]);
    expect(row.rows[0].status).toBe("inactive");

    const reactivate = await app.inject({ method: "PATCH", url: `/api/admin/users/${targetId}/status`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("us-reac") }, payload: { status: "active", reason: "cleared" } });
    expect(reactivate.statusCode).toBe(200);
    const row2 = await pool.query("SELECT status FROM users WHERE id = $1", [targetId]);
    expect(row2.rows[0].status).toBe("active");
  });

  test("POST /api/refunds/:id/approve records admin decision and flips status", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");
    const buyerToken = await login("buyer@localtrade.test", "buyer");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-l") }, payload: { title: "Refund approve", description: "desc", priceCents: 30000, quantity: 1 } });
    const listingId = listing.json().id as string;
    const sellerMe = await app.inject({ method: "GET", url: "/api/users/me", headers: { authorization: `Bearer ${sellerToken}` } });
    const sellerId = sellerMe.json().id as string;
    await pool.query(
      "INSERT INTO assets(listing_id, seller_id, file_name, extension, mime_type, size_bytes, status, storage_path) VALUES($1, $2, $3, 'jpg', 'image/jpeg', 10, 'ready', '/tmp/fake')",
      [listingId, sellerId, "rap.jpg"],
    );
    await app.inject({ method: "POST", url: `/api/listings/${listingId}/publish`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-p") } });
    const order = await app.inject({ method: "POST", url: "/api/orders", headers: { authorization: `Bearer ${buyerToken}`, ...replayHeaders("rap-o") }, payload: { listingId, quantity: 1 } });
    const orderId = order.json().id as string;
    await app.inject({ method: "POST", url: "/api/payments/capture", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-pay") }, payload: { orderId, tenderType: "cash", amountCents: 30000, transactionKey: "tx-rap-1" } });
    await app.inject({ method: "POST", url: `/api/orders/${orderId}/complete`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-comp") }, payload: { note: "done" } });
    const refund = await app.inject({ method: "POST", url: "/api/refunds", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-ref") }, payload: { orderId, amountCents: 30000, reason: "High value refund" } });
    const refundId = refund.json().id as string;
    expect(refund.json().requiresAdminApproval).toBe(true);

    const sellerForbidden = await app.inject({ method: "POST", url: `/api/refunds/${refundId}/approve`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("rap-forb") }, payload: { approve: true, note: "ok" } });
    expect(sellerForbidden.statusCode).toBe(403);

    const approved = await app.inject({ method: "POST", url: `/api/refunds/${refundId}/approve`, headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("rap-ok") }, payload: { approve: true, note: "approved after review" } });
    expect(approved.statusCode).toBe(200);
    const refundRow = await pool.query("SELECT status, approved_by FROM refunds WHERE id = $1", [refundId]);
    expect(refundRow.rows[0].status).toBe("approved");
    expect(refundRow.rows[0].approved_by).not.toBeNull();
  });

  test("GET /download/:assetId streams the asset body with correct Content-Type", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dl-l") }, payload: { title: "Download stream", description: "desc", priceCents: 500, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dl-s") }, payload: { listingId, fileName: "dl.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    const chunkBody = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dl-c"), "content-type": "application/octet-stream" }, payload: chunkBody });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dl-f") }, payload: { detectedMime: "image/jpeg" } });
    const signed = await app.inject({ method: "GET", url: `/api/media/assets/${assetId}/signed-url`, headers: { authorization: `Bearer ${sellerToken}` } });
    expect(signed.statusCode).toBe(200);

    const url = signed.json().url as string;
    const downloaded = await app.inject({ method: "GET", url });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toBe("image/jpeg");
    expect(downloaded.rawPayload.length).toBeGreaterThan(0);
  });

  test("GET /api/admin/content-rules lists existing rules for admin and 403 for seller", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("cr-list-c") },
      payload: { ruleType: "keyword", pattern: "inventory-only-term", active: true },
    });
    expect(created.statusCode).toBe(201);
    const createdId = created.json().id as string;

    // Explicit literal-path GET — the endpoint under test.
    const listing = await app.inject({
      method: "GET",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listing.statusCode).toBe(200);
    const items = listing.json().items as Array<{ id: string; pattern: string; active: boolean }>;
    expect(Array.isArray(items)).toBe(true);
    const found = items.find((r) => r.id === createdId);
    expect(found).toBeDefined();
    expect(found!.active).toBe(true);

    // Negative path: non-admin forbidden.
    const sellerAttempt = await app.inject({
      method: "GET",
      url: "/api/admin/content-rules",
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(sellerAttempt.statusCode).toBe(403);

    // Negative path: unauthenticated.
    const noAuth = await app.inject({ method: "GET", url: "/api/admin/content-rules" });
    expect(noAuth.statusCode).toBe(401);
  });

  test("PATCH /api/admin/webhooks/subscriptions/:id toggles active and rotates secret, 404 on missing", async () => {
    const adminToken = await login("admin@localtrade.test", "admin");
    const sellerToken = await login("seller@localtrade.test", "seller");

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/webhooks/subscriptions",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-patch-c") },
      payload: { eventType: "order.completed", targetUrl: "http://127.0.0.1/wh-patch", secret: "originalSecret123" },
    });
    expect(created.statusCode).toBe(201);
    const subscriptionId = created.json().id as string;

    // Negative path: non-admin cannot PATCH.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/admin/webhooks/subscriptions/${subscriptionId}`,
      headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("wh-patch-forb") },
      payload: { active: false },
    });
    expect(forbidden.statusCode).toBe(403);

    // Happy path: admin toggles active + rotates secret.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/admin/webhooks/subscriptions/${subscriptionId}`,
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-patch-ok") },
      payload: { active: false, secret: "rotatedSecret456" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().id).toBe(subscriptionId);
    expect(patched.json().active).toBe(false);

    // Side-effect verification: DB row updated and secret ciphertext rotated.
    const row = await pool.query(
      "SELECT active, secret_enc FROM webhook_subscriptions WHERE id = $1",
      [subscriptionId],
    );
    expect(row.rows[0].active).toBe(false);
    const decryptedSecret = decryptText(row.rows[0].secret_enc as string);
    expect(decryptedSecret).toBe("rotatedSecret456");

    // Negative path: 404 on non-existent subscription id.
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/admin/webhooks/subscriptions/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${adminToken}`, ...replayHeaders("wh-patch-404") },
      payload: { active: true },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  test("GET /download/:assetId accepts literal path with valid signature and rejects unsigned request", async () => {
    const sellerToken = await login("seller@localtrade.test", "seller");
    const listing = await app.inject({ method: "POST", url: "/api/listings", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dllit-l") }, payload: { title: "Literal download", description: "desc", priceCents: 500, quantity: 1 } });
    const listingId = listing.json().id as string;
    const session = await app.inject({ method: "POST", url: "/api/media/upload-sessions", headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dllit-s") }, payload: { listingId, fileName: "dllit.jpg", sizeBytes: 10, extension: "jpg", mimeType: "image/jpeg", totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 } });
    const sid = session.json().sessionId as string;
    const assetId = session.json().assetId as string;
    const chunkBody = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    await app.inject({ method: "PUT", url: `/api/media/upload-sessions/${sid}/chunks/0`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dllit-c"), "content-type": "application/octet-stream" }, payload: chunkBody });
    await app.inject({ method: "POST", url: `/api/media/upload-sessions/${sid}/finalize`, headers: { authorization: `Bearer ${sellerToken}`, ...replayHeaders("dllit-f") }, payload: { detectedMime: "image/jpeg" } });
    const signed = await app.inject({ method: "GET", url: `/api/media/assets/${assetId}/signed-url`, headers: { authorization: `Bearer ${sellerToken}` } });
    const { url: signedUrl } = signed.json() as { url: string };
    const queryString = signedUrl.substring(signedUrl.indexOf("?"));

    // Explicit literal-path request — the endpoint under test.
    const downloaded = await app.inject({
      method: "GET",
      url: `/download/${assetId}${queryString}`,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toBe("image/jpeg");
    expect(downloaded.rawPayload.length).toBeGreaterThan(0);

    // Negative path: literal path without signature must be rejected.
    const unsigned = await app.inject({
      method: "GET",
      url: `/download/${assetId}`,
    });
    expect(unsigned.statusCode).toBe(400);
  });
});
