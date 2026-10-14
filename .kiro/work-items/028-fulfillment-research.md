---
issue: 28
title: Fulfillment provider research
status: done
date: 2026-10-14
---

# Fulfillment Provider Evaluation (Issue #28)

## 1. Summary & Recommendation

**Recommend Printful.** For a pre-revenue, single-dev, US-only DTG t-shirt storefront on Lambda/DynamoDB/Stripe, Printful is the cleanest fit on the two decisive axes — API quality and economics-at-low-volume. Its Orders API lets us submit an order directly against a catalog `variant_id` with a per-order print-file URL (no pre-created product required), authenticates with a simple private bearer token, has a mature Node ecosystem, and emits order-lifecycle webhooks (`order_updated`, `package_shipped`) that map directly onto our future paid→submitted→shipped tracking (issue #30). On cost, Printful has a genuine free tier (no monthly fee, pay-per-order), so at single-to-low-double-digit orders/month we pay nothing until an order is placed. Printify is a legitimate close second (lower blank cost, but its best pricing sits behind a ~$39/mo Premium tier that only pays off above ~15–20 orders/month, and its order model is product/variant-centric). **Gooten is effectively out of contention** — it has pivoted to "OrderMesh," an enterprise order-management platform aimed at brands/marketplaces at scale, which is a poor fit for a small store and a signal of reduced focus on small self-serve merchants.

**Single most decisive reason:** Printful's free, pay-per-order model + a catalog-variant order flow that drops almost directly into the existing no-op `submitToFulfillment(order)` hook, with no monthly fee and no mandatory product pre-creation.

**Needs human verification:** exact current per-unit blank + DTG print cost and US shipping/fulfillment time (pricing is time-sensitive — see §5), and that a private token's scopes/expiry policy fit an unattended Lambda (tokens expire and are not auto-refreshed).

## 2. Comparison Matrix

| Criterion | Printful | Printify | Gooten |
|---|---|---|---|
| **API quality** | Mature REST, well-documented, OpenAPI/Postman | Good REST, documented, rate-limited | REST exists; now subordinate to OrderMesh platform |
| **Auth model** | Private bearer token (OAuth also for public apps); token expires, no auto-refresh | API token with selectable scopes | `RecipeID` in request URL |
| **Node SDK** | Community SDKs + simple REST (easy to hand-roll) | Community `printify-sdk-js` (maintained 2025) | No notable maintained Node SDK |
| **Order submission** | `POST /orders` with `recipient` + `items`; `?confirm=1` to auto-submit | `POST` order to a shop; order moves to "On hold" → production | Order API w/ `RecipeID`; webhook status updates |
| **Maps to our Order schema** | Direct: `recipient{name,address1,address2,city,state_code,country_code,zip}` + `items[{variant_id,quantity,files}]` | Needs product/variant pre-created; order references those IDs | Requires platform-specific mapping |
| **Per-order print file (no pre-created product)** | **Yes** — catalog `variant_id` + `files[].url` per order | No — must pre-create product (blueprint+variant) then order it | Push artwork per order supported, but via OrderMesh flow |
| **Status webhooks** | `order_created/updated/failed/canceled`, `package_shipped`, hold events | Webhooks available | Webhooks for order status |
| **T-shirt blanks** | Bella+Canvas 3001 (product 71), Gildan, etc. | Bella+Canvas 3001, Gildan 5000, etc. (900+ providers) | Broad network |
| **Print method** | In-house DTG, strong QC reputation | DTG via 3rd-party print providers (quality varies by provider) | Distributed network |
| **Monthly fee / free tier** | **Free tier, no monthly fee**; optional Growth $24.99/mo | Free tier; Premium ~$39/mo ($24.99 annual) for up to 20% off | Enterprise/platform-oriented |
| **Blank t-shirt base cost (B+C 3001, approx)** | ~$11.5–11.7 | ~$10.98 ($8.77 w/ Premium) | Not reliably confirmed |
| **US domestic shipping (shirts)** | starts ~$4.75 | provider-dependent | Not reliably confirmed |
| **Fit for small, pre-revenue store** | **Strong** | Good (fee only pays off at volume) | **Poor** (enterprise pivot) |

## 3. Per-Provider Notes

### Printful
- **API model:** Three ways to specify an order item: (A) sync variant in your store, (B) **catalog `variant_id` on the fly with print files — usable when the store has no pre-created products**, or (C) product template. Method B is ideal for us: one `POST /orders` call per paid order, `?confirm=1` to skip the draft stage. Private bearer token auth; order status lifecycle is `draft → pending/inreview → inprocess → fulfilled`, surfaced via webhooks.
- **Economics:** Free tier, no monthly fee, pay-per-order. B+C 3001 blank ~$11.5–11.7, US shirt shipping from ~$4.75. At ~$25–32 retail that leaves a workable margin before Stripe fees. Optional Growth plan ($24.99/mo) only worth it later.
- **Pros:** No monthly fee; per-order print-file flow fits the hook; in-house DTG + QC; rich webhooks; idempotency via `external_id` (use our `orderId`).
- **Cons:** Private token expires and is **not** auto-refreshed — needs a rotation plan for an unattended Lambda. Slightly higher blank cost than Printify.

### Printify
- **API model:** Order creation references products that must first exist in a shop (blueprint + print provider + variant). API can create products programmatically, but the order path is product/variant-centric rather than "print file per order." Submitted orders land "On hold" then go to production per approval settings. Token with selectable scopes.
- **Economics:** Permanent free plan; Premium ~$39/mo (or $24.99 billed annually) for up to ~20% off blanks — breaks even around 15–20 orders/month. B+C 3001 from ~$10.98 ($8.77 w/ Premium).
- **Pros:** Lowest blank cost at volume; huge provider network; maintained Node SDK.
- **Cons:** Best economics gated behind a monthly fee we can't justify pre-revenue; must mirror product/variant IDs; DTG quality varies by chosen print provider.

### Gooten
- **API model:** REST with `RecipeID` auth and status webhooks, but the business has repositioned around **OrderMesh**, an order-management platform for brands/marketplaces/decorators at scale. The small-merchant self-serve path is de-emphasized.
- **Economics:** Not reliably confirmable from current public sources; oriented toward enterprise/custom.
- **Pros:** Large production network; fast quoted production times.
- **Cons:** Strategic pivot away from small merchants; thin Node tooling; mapping overhead. **Not recommended for this storefront.**

## 4. Integration Implications (high-level — detailed design is issue #29)

Our current hook is a no-op `submitToFulfillment(order)` in the webhook Lambda, called after Stripe confirms payment. With Printful (method B):

- **`submitToFulfillment()` becomes:** build a Printful order from our `order` and `POST /orders?confirm=1`.
  - `recipient` ← `shippingAddress` (near 1:1 field map; our `line1/line2` → `address1/address2`, `state`→`state_code`, `country`→`country_code`).
  - `items[]` ← `order.items`, each needing a Printful **catalog `variant_id`** and a **print-file URL** per item.
  - Set `external_id = orderId` for **idempotency** (safe retries from Lambda; also lets webhooks correlate back to our order).
- **Order schema impact (minimal):** we must resolve each line item to (a) a Printful catalog `variant_id` and (b) a print-file URL. That means mirroring a small mapping in DynamoDB — our product/size (S/M/L/XL) → Printful `variant_id`, plus the artwork URL per design. We do **not** need to pre-create products in Printful.
- **Secrets/auth:** store the Printful token in the Lambda's existing secret mechanism; note the token expiry/rotation caveat.
- **Status tracking (issue #30):** register one Printful webhook URL; consume `order_updated` / `package_shipped` (carries tracking number/URL) to drive our paid→submitted→shipped lifecycle and the shipped-order email via SES.
- **Lambda/event-driven gotchas:** respect the 120 req/min rate limit and honor `Retry-After` on 429s (low volume makes this a non-issue initially); print-file processing is async, so an order can briefly revert to a hold/draft state — rely on webhooks rather than the synchronous create response for final status.

## 5. Open Questions / Verify at Integration Time

- **Exact per-unit economics (time-sensitive):** confirm live B+C 3001 (or chosen blank) base cost, DTG print cost, and US shipping/fulfillment time at order time — the figures here (~$11.5 blank, ~$4.75 shipping) are from Oct 2026 sources and drift.
- **Token lifecycle in Lambda:** confirm private-token expiry window and build a rotation/renewal path, since tokens are not auto-refreshed and an expired token silently breaks fulfillment.
- **Variant mapping source of truth:** decide whether Printful `variant_id`s live in the seed scripts/DynamoDB product records (recommended) and how S/M/L/XL map to specific catalog variant IDs.
- **Artwork hosting:** print-file URLs must be publicly fetchable by Printful; confirm whether to serve from the existing S3/CloudFront bucket.
- **Webhook security:** confirm how to verify inbound Printful webhooks (store ID check / shared secret) before trusting status transitions.
- **Tax/retail costs:** decide whether to pass `retail_price`/`retail_costs` for accurate packing slips (US domestic — low priority initially).

## 6. Sources

Pricing is time-sensitive; figures reflect sources accessed **2026-10-14**.

- Printful Orders API (order model, catalog-variant method B, print files, webhooks, auth, rate limits) — https://www.printful.com/docs/orders (accessed 2026-10-14)
- Printful pricing / free tier & Growth plan — https://help.printful.com/hc/en-us/articles/50261163157905 and https://www.printful.com/plans (accessed 2026-10-14)
- Printful t-shirt cost (B+C 3001 ~$11.5–11.7; US shirt shipping from ~$4.75) — printful.com blog + podtomatic comparison (accessed 2026-10-14); *content rephrased for compliance*
- Printify API reference (overview, order/product model, rate limits) — https://developers.printify.com/ and help.printify.com (accessed 2026-10-14)
- Printify pricing (free plan; Premium ~$39/mo or $24.99 annual; B+C 3001 ~$10.98 / $8.77 Premium) — https://www.printify.com/pricing/ and printify.com blog (accessed 2026-10-14)
- Printify Node SDK — https://github.com/spencerlepine/printify-sdk-js (accessed 2026-10-14)
- Gooten → OrderMesh pivot (enterprise order-management repositioning) — https://gooten.com/blog/gooten-to-ordermesh/ and gooten.com/blog/what-is-ordermesh/ (accessed 2026-10-14)
- Gooten API getting started / order status / webhooks — gooten.com/api-documentation (accessed 2026-10-14)
