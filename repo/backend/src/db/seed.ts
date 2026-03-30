import { hash } from "@node-rs/argon2";
import { pool } from "./pool.js";

async function upsertUser(email: string, password: string, displayName: string, roleCodes: string[]) {
  const passwordHash = await hash(password);
  const userRes = await pool.query(
    `INSERT INTO users(email, password_hash, display_name)
     VALUES($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name
     RETURNING id`,
    [email, passwordHash, displayName],
  );
  const userId: string = userRes.rows[0].id;
  await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  for (const code of roleCodes) {
    await pool.query(
      `INSERT INTO user_roles(user_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.code = $2
       ON CONFLICT DO NOTHING`,
      [userId, code],
    );
  }
}

async function upsertListing(
  sellerEmail: string,
  title: string,
  description: string,
  priceCents: number,
  quantity: number,
  status: "draft" | "flagged" | "published" | "removed" = "published",
) {
  await pool.query(
    `
      INSERT INTO listings(seller_id, title, description, price_cents, quantity, status)
      SELECT u.id, $2, $3, $4, $5, $6
      FROM users u
      WHERE u.email = $1
        AND NOT EXISTS (
          SELECT 1 FROM listings l WHERE l.seller_id = u.id AND l.title = $2
        )
    `,
    [sellerEmail, title, description, priceCents, quantity, status],
  );
}

async function getUserIdByEmail(email: string) {
  const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (!result.rowCount) throw new Error(`Missing seed user: ${email}`);
  return result.rows[0].id as string;
}

async function getListingIdByTitle(sellerId: string, title: string) {
  const result = await pool.query("SELECT id FROM listings WHERE seller_id = $1 AND title = $2", [sellerId, title]);
  if (!result.rowCount) throw new Error(`Missing seed listing: ${title}`);
  return result.rows[0].id as string;
}

async function upsertOrder(input: {
  buyerId: string;
  listingId: string;
  quantity: number;
  totalCents: number;
  status: "placed" | "payment_captured" | "completed" | "cancelled" | "refunded";
  completedAt?: string | null;
}) {
  const existing = await pool.query(
    `SELECT id FROM orders
     WHERE buyer_id = $1 AND listing_id = $2 AND quantity = $3 AND total_cents = $4 AND status = $5
     LIMIT 1`,
    [input.buyerId, input.listingId, input.quantity, input.totalCents, input.status],
  );
  if (existing.rowCount) return existing.rows[0].id as string;

  const inserted = await pool.query(
    `INSERT INTO orders(buyer_id, listing_id, quantity, total_cents, status, completed_at)
     VALUES($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [input.buyerId, input.listingId, input.quantity, input.totalCents, input.status, input.completedAt ?? null],
  );
  return inserted.rows[0].id as string;
}

async function upsertPayment(input: { orderId: string; amountCents: number; transactionKey: string; tenderType?: "cash" | "check" | "store_credit" | "card_terminal_import" }) {
  await pool.query(
    `INSERT INTO payments(order_id, tender_type, amount_cents, transaction_key, status)
     VALUES($1, $2, $3, $4, 'captured')
     ON CONFLICT (transaction_key) DO NOTHING`,
    [input.orderId, input.tenderType ?? "cash", input.amountCents, input.transactionKey],
  );
}

async function upsertRefund(input: {
  orderId: string;
  sellerId: string;
  amountCents: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "confirmed";
  requiresAdminApproval: boolean;
  confirmedAt?: string | null;
}) {
  await pool.query(
    `
      INSERT INTO refunds(order_id, seller_id, amount_cents, reason, status, requires_admin_approval, confirmed_at)
      SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE NOT EXISTS (
        SELECT 1 FROM refunds r
        WHERE r.order_id = $1 AND r.status = $5 AND r.amount_cents = $3 AND r.reason = $4
      )
    `,
    [input.orderId, input.sellerId, input.amountCents, input.reason, input.status, input.requiresAdminApproval, input.confirmedAt ?? null],
  );
}

async function upsertReview(input: {
  orderId: string;
  buyerId: string;
  sellerId: string;
  rating: number;
  body: string;
  underAppeal?: boolean;
  removedByArbitration?: boolean;
}) {
  const result = await pool.query(
    `INSERT INTO reviews(order_id, buyer_id, seller_id, rating, body, under_appeal, removed_by_arbitration)
     VALUES($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (order_id)
     DO UPDATE SET rating = EXCLUDED.rating,
                   body = EXCLUDED.body,
                   under_appeal = EXCLUDED.under_appeal,
                   removed_by_arbitration = EXCLUDED.removed_by_arbitration
     RETURNING id`,
    [
      input.orderId,
      input.buyerId,
      input.sellerId,
      input.rating,
      input.body,
      input.underAppeal ?? false,
      input.removedByArbitration ?? false,
    ],
  );
  return result.rows[0].id as string;
}

async function upsertAppeal(input: { reviewId: string; sellerId: string; reason: string }) {
  await pool.query(
    `
      INSERT INTO appeals(review_id, seller_id, status, reason)
      SELECT $1, $2, 'open', $3
      WHERE NOT EXISTS (
        SELECT 1 FROM appeals a WHERE a.review_id = $1 AND a.status = 'open'
      )
    `,
    [input.reviewId, input.sellerId, input.reason],
  );
}

async function upsertContentRule(pattern: string) {
  const existing = await pool.query("SELECT id FROM content_rules WHERE pattern = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1", [pattern]);
  if (existing.rowCount) return existing.rows[0].id as string;

  const result = await pool.query(
    `INSERT INTO content_rules(rule_type, pattern, active)
     VALUES('keyword', $1, true)
     RETURNING id`,
    [pattern],
  );
  if (!result.rowCount) throw new Error(`Failed to create content rule: ${pattern}`);
  return result.rows[0].id as string;
}

async function upsertFlaggedListing(sellerId: string, flaggedRuleId: string) {
  await pool.query(
    `
      INSERT INTO listings(seller_id, title, description, price_cents, quantity, status, flagged_rule_id)
      SELECT $1, 'Banned Counterfeit Bundle', 'Seeded flagged listing for moderation queue demo.', 5000, 4, 'flagged', $2
      WHERE NOT EXISTS (
        SELECT 1 FROM listings l WHERE l.seller_id = $1 AND l.title = 'Banned Counterfeit Bundle'
      )
    `,
    [sellerId, flaggedRuleId],
  );
}

export async function runSeed(includeDemoData = false) {
  await upsertUser("buyer@localtrade.test", "buyer", "Local Buyer", ["buyer"]);
  await upsertUser("seller@localtrade.test", "seller", "Local Seller", ["seller"]);
  await upsertUser("moderator@localtrade.test", "moderator", "Local Moderator", ["moderator"]);
  await upsertUser("arbitrator@localtrade.test", "arbitrator", "Local Arbitrator", ["arbitrator"]);
  await upsertUser("admin@localtrade.test", "admin", "Local Admin", ["admin"]);

  await upsertListing(
    "seller@localtrade.test",
    "Fresh Farm Eggs (Dozen)",
    "Locally sourced cage-free eggs from nearby farms.",
    650,
    40,
    "published",
  );
  await upsertListing(
    "seller@localtrade.test",
    "Handmade Wooden Cutting Board",
    "Solid hardwood cutting board finished with food-safe oil.",
    3200,
    12,
    "published",
  );
  await upsertListing(
    "seller@localtrade.test",
    "Seasonal Vegetable Basket",
    "Weekly mixed basket of fresh seasonal vegetables.",
    2400,
    18,
    "published",
  );
  await upsertListing(
    "seller@localtrade.test",
    "Local Honey 500g",
    "Raw wildflower honey harvested by a local beekeeper.",
    1450,
    25,
    "published",
  );

  if (includeDemoData) {
    const buyerId = await getUserIdByEmail("buyer@localtrade.test");
    const sellerId = await getUserIdByEmail("seller@localtrade.test");
    const honeyListingId = await getListingIdByTitle(sellerId, "Local Honey 500g");
    const eggsListingId = await getListingIdByTitle(sellerId, "Fresh Farm Eggs (Dozen)");
    const boardListingId = await getListingIdByTitle(sellerId, "Handmade Wooden Cutting Board");
    const basketListingId = await getListingIdByTitle(sellerId, "Seasonal Vegetable Basket");

    await upsertOrder({
      buyerId,
      listingId: honeyListingId,
      quantity: 2,
      totalCents: 2900,
      status: "placed",
    });

    const reviewedOrderId = await upsertOrder({
      buyerId,
      listingId: eggsListingId,
      quantity: 3,
      totalCents: 1950,
      status: "completed",
      completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await upsertPayment({ orderId: reviewedOrderId, amountCents: 1950, transactionKey: "seed-txn-eggs-completed" });
    await upsertReview({
      orderId: reviewedOrderId,
      buyerId,
      sellerId,
      rating: 5,
      body: "Great quality and exactly as described. Smooth pickup and friendly seller.",
    });

    const appealedOrderId = await upsertOrder({
      buyerId,
      listingId: basketListingId,
      quantity: 1,
      totalCents: 2400,
      status: "completed",
      completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await upsertPayment({ orderId: appealedOrderId, amountCents: 2400, transactionKey: "seed-txn-basket-completed" });
    const appealedReviewId = await upsertReview({
      orderId: appealedOrderId,
      buyerId,
      sellerId,
      rating: 2,
      body: "Delivery was late and packaging was damaged.",
      underAppeal: true,
    });
    await upsertAppeal({
      reviewId: appealedReviewId,
      sellerId,
      reason: "Seller disputes the delivery condition and requests arbitration review.",
    });

    const removedReviewOrderId = await upsertOrder({
      buyerId,
      listingId: honeyListingId,
      quantity: 1,
      totalCents: 1450,
      status: "completed",
      completedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await upsertPayment({ orderId: removedReviewOrderId, amountCents: 1450, transactionKey: "seed-txn-honey-completed" });
    await upsertReview({
      orderId: removedReviewOrderId,
      buyerId,
      sellerId,
      rating: 1,
      body: "Removed sample review for arbitration badge preview.",
      removedByArbitration: true,
    });

    const refundPendingOrderId = await upsertOrder({
      buyerId,
      listingId: boardListingId,
      quantity: 10,
      totalCents: 32000,
      status: "completed",
      completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await upsertPayment({ orderId: refundPendingOrderId, amountCents: 32000, transactionKey: "seed-txn-board-completed" });
    await upsertRefund({
      orderId: refundPendingOrderId,
      sellerId,
      amountCents: 30000,
      reason: "Customer reported damage, pending admin approval.",
      status: "pending",
      requiresAdminApproval: true,
    });

    const refundedOrderId = await upsertOrder({
      buyerId,
      listingId: basketListingId,
      quantity: 2,
      totalCents: 4800,
      status: "refunded",
      completedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await upsertPayment({ orderId: refundedOrderId, amountCents: 4800, transactionKey: "seed-txn-basket-refunded" });
    await upsertRefund({
      orderId: refundedOrderId,
      sellerId,
      amountCents: 4800,
      reason: "Confirmed refund sample",
      status: "confirmed",
      requiresAdminApproval: false,
      confirmedAt: new Date().toISOString(),
    });

    const flaggedRuleId = await upsertContentRule("counterfeit");
    await upsertFlaggedListing(sellerId, flaggedRuleId);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed(true)
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
