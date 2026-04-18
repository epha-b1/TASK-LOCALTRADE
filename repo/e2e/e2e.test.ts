import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Full-stack E2E: runs against a live docker-compose stack (frontend + api + postgres).
// The frontend container's nginx proxies /api and /download to the API container,
// so hitting the frontend origin exercises the real FE↔BE boundary.
//
// Invoked via: `docker compose run --rm e2e` (see repo/docker-compose.yml).

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://frontend:80";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://api:3000";

function replayHeaders(seed: string): Record<string, string> {
  return {
    "X-Request-Nonce": `e2e-${seed}-${Date.now()}-${Math.random()}`,
    "X-Request-Timestamp": `${Math.floor(Date.now() / 1000)}`,
  };
}

async function waitFor(url: string, isOk: (res: Response) => boolean | Promise<boolean>) {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (await isOk(res)) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastErr)}`);
}

describe("fullstack E2E (frontend nginx → API → postgres)", () => {
  beforeAll(async () => {
    await waitFor(`${API_ORIGIN}/health/ready`, async (res) => res.ok);
    await waitFor(`${FRONTEND_ORIGIN}/`, (res) => res.status === 200);
  });

  afterAll(async () => {
    // nothing to clean — stack is managed by docker compose
  });

  test("serves the Angular SPA at the frontend origin", async () => {
    const res = await fetch(`${FRONTEND_ORIGIN}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // The Angular entrypoint is index.html — sniff for the app-root tag the build produces.
    expect(body.toLowerCase()).toContain("<app-root");
  });

  test("buyer login → list → order flow travels frontend proxy → api → db", async () => {
    // 1) login through the frontend nginx proxy (FE↔BE boundary)
    const login = await fetch(`${FRONTEND_ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...replayHeaders("login") },
      body: JSON.stringify({ email: "buyer@localtrade.test", password: "buyer" }),
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { accessToken: string; roles: string[] };
    expect(loginBody.accessToken).toBeTruthy();
    expect(loginBody.roles).toContain("buyer");

    // 2) list public storefront through the proxy
    const storefront = await fetch(`${FRONTEND_ORIGIN}/api/storefront/listings`);
    expect(storefront.status).toBe(200);
    const storefrontBody = (await storefront.json()) as { items: Array<{ id: string; title: string; seller_id: string }> };
    expect(Array.isArray(storefrontBody.items)).toBe(true);

    // 3) seller-only core action: create a listing and verify persistence
    const sellerLogin = await fetch(`${FRONTEND_ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...replayHeaders("seller-login") },
      body: JSON.stringify({ email: "seller@localtrade.test", password: "seller" }),
    });
    const { accessToken: sellerToken } = (await sellerLogin.json()) as { accessToken: string };
    expect(sellerToken).toBeTruthy();

    const create = await fetch(`${FRONTEND_ORIGIN}/api/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sellerToken}`,
        ...replayHeaders("create"),
      },
      body: JSON.stringify({ title: "E2E Listing", description: "Round-trip smoke", priceCents: 1500, quantity: 2 }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; status: string };
    expect(created.id).toBeTruthy();
    expect(["draft", "flagged"]).toContain(created.status);

    // 4) verify the listing is observable via a second proxied GET (seller's own listings)
    const myListings = await fetch(`${FRONTEND_ORIGIN}/api/listings`, {
      headers: { Authorization: `Bearer ${sellerToken}`, ...replayHeaders("my-listings") },
    });
    expect(myListings.status).toBe(200);
    const myBody = (await myListings.json()) as { items: Array<{ id: string }> };
    expect(myBody.items.some((l) => l.id === created.id)).toBe(true);
  });
});
