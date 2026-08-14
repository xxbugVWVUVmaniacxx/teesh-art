# teesh-art — Low-Level Design

## Table of Contents

1. [Data Model](#1-data-model)
2. [API Contracts](#2-api-contracts)
3. [Stripe Integration](#3-stripe-integration)
4. [Order Lifecycle](#4-order-lifecycle)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Infrastructure (SAM)](#6-infrastructure-sam)
7. [CI/CD Pipeline](#7-cicd-pipeline)
8. [Monitoring & Alerting](#8-monitoring--alerting)
9. [Cost Model](#9-cost-model)

---

## 1. Data Model

### Overview

All application data lives in a single DynamoDB table using a single-table design. This keeps infrastructure simple, reduces cross-table coordination, and allows all access patterns to be served from one provisioned resource.

### Table: `teesh-art-data`

| Setting | Value |
|---------|-------|
| Billing mode | On-demand (PAY_PER_REQUEST) |
| Partition key | `PK` (String) |
| Sort key | `SK` (String) |
| GSI-1 | `GSI1PK` / `GSI1SK` |

### Entity schemas

#### Product

Represents a t-shirt design available for purchase.

| Attribute | Type | Example |
|-----------|------|---------|
| `PK` | String | `PRODUCT#tee-001` |
| `SK` | String | `METADATA` |
| `GSI1PK` | String | `PRODUCTS` |
| `GSI1SK` | String | `2026-08-10T00:00:00Z` (createdAt for sort) |
| `productId` | String | `tee-001` |
| `name` | String | `Midnight Owl` |
| `description` | String | `A hand-drawn owl...` |
| `priceCents` | Number | `2500` |
| `currency` | String | `usd` |
| `images` | List<String> | `["s3://teesh-art-media/tee-001/front.png"]` |
| `status` | String | `active` \| `draft` \| `archived` |
| `createdAt` | String (ISO 8601) | `2026-08-10T00:00:00Z` |
| `updatedAt` | String (ISO 8601) | `2026-08-12T14:30:00Z` |

#### Order

Represents a customer purchase.

| Attribute | Type | Example |
|-----------|------|---------|
| `PK` | String | `ORDER#ord-abc123` |
| `SK` | String | `METADATA` |
| `GSI1PK` | String | `ORDERS` |
| `GSI1SK` | String | `2026-08-13T22:00:00Z` (createdAt) |
| `orderId` | String | `ord-abc123` |
| `stripeSessionId` | String | `cs_live_...` |
| `customerEmail` | String | `buyer@example.com` |
| `shippingAddress` | Map | `{name, line1, line2, city, state, zip, country}` |
| `items` | List<Map> | `[{productId, name, priceCents, quantity}]` |
| `totalCents` | Number | `2500` |
| `status` | String | `paid` \| `submitted` \| `in_production` \| `shipped` \| `delivered` \| `failed` |
| `fulfillmentId` | String | (provider's reference, when assigned) |
| `trackingNumber` | String | (when shipped) |
| `createdAt` | String (ISO 8601) | |
| `updatedAt` | String (ISO 8601) | |

#### Order line items (denormalized into Order)

Line items are stored as a list within the Order entity. At current scale (single-digit items per order), this avoids an extra query per order read.

### Access patterns

| Pattern | Key condition | Index |
|---------|--------------|-------|
| Get product by ID | `PK = PRODUCT#<id>, SK = METADATA` | Table |
| List all active products (sorted by date) | `GSI1PK = PRODUCTS` | GSI-1 |
| Get order by ID | `PK = ORDER#<id>, SK = METADATA` | Table |
| List all orders (sorted by date) | `GSI1PK = ORDERS` | GSI-1 |

### Future access patterns (not built yet)

| Pattern | Notes |
|---------|-------|
| Orders by customer email | Add GSI-2 if needed |
| Orders by status | Filter on GSI-1 query (acceptable at low volume) |
| Product variants (size, color) | Extend product schema with variants list |

---

## 2. API Contracts

### Base URL

```
https://api.teesh-art.com  (→ API Gateway HTTP API → CloudFront custom domain, later)
```

During development: `https://<api-id>.execute-api.us-east-1.amazonaws.com`

### Endpoints

#### `GET /products`

Returns all active products for the catalog.

**Response 200:**
```json
{
  "products": [
    {
      "productId": "tee-001",
      "name": "Midnight Owl",
      "description": "A hand-drawn owl...",
      "priceCents": 2500,
      "currency": "usd",
      "images": ["https://cdn.teesh-art.com/tee-001/front.png"],
      "createdAt": "2026-08-10T00:00:00Z"
    }
  ]
}
```

**Lambda:** `teesh-art-get-products`
**Notes:** This endpoint is called at build time by Astro (not at runtime by customers). Caching is handled by the static build.

---

#### `GET /products/:productId`

Returns a single product by ID.

**Response 200:**
```json
{
  "productId": "tee-001",
  "name": "Midnight Owl",
  "description": "A hand-drawn owl...",
  "priceCents": 2500,
  "currency": "usd",
  "images": ["https://cdn.teesh-art.com/tee-001/front.png"],
  "status": "active",
  "createdAt": "2026-08-10T00:00:00Z"
}
```

**Response 404:**
```json
{ "error": "Product not found" }
```

**Lambda:** `teesh-art-get-products` (same function, routed by path)

---

#### `POST /checkout`

Creates a Stripe Checkout Session and returns the URL for redirect.

**Request body:**
```json
{
  "items": [
    { "productId": "tee-001", "quantity": 1 }
  ]
}
```

**Response 200:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_live_..."
}
```

**Response 400:**
```json
{ "error": "Invalid product ID or quantity" }
```

**Lambda:** `teesh-art-checkout`
**Notes:** Validates product IDs against DynamoDB, constructs Stripe line items from stored prices (never trusts client-provided prices), creates CheckoutSession with shipping address collection enabled.

---

#### `POST /webhooks/stripe`

Receives Stripe webhook events. Not called by the frontend.

**Headers:** `Stripe-Signature` (verified by Lambda)

**Handled events:**
- `checkout.session.completed` → Create order record, trigger fulfillment
- `checkout.session.expired` → No action (log only)

**Response:** `200` (always, to avoid Stripe retries on non-retriable errors)

**Lambda:** `teesh-art-webhook`

---

### Error shape (all endpoints)

```json
{
  "error": "Human-readable description"
}
```

HTTP status codes: 200 (success), 400 (bad request), 404 (not found), 500 (internal error).

---

## 3. Stripe Integration

### Flow

```
Customer clicks "Buy"
        │
        ▼
Frontend calls POST /checkout with cart items
        │
        ▼
Lambda validates items against DynamoDB prices
        │
        ▼
Lambda calls stripe.checkout.sessions.create()
  - line_items (from DB, not client)
  - shipping_address_collection: { allowed_countries: ["US"] }
  - success_url: https://teesh-art.com/order-confirmed?session_id={CHECKOUT_SESSION_ID}
  - cancel_url: https://teesh-art.com/cart
  - mode: "payment"
        │
        ▼
Lambda returns { checkoutUrl } to frontend
        │
        ▼
Frontend redirects customer to Stripe Checkout
        │
        ▼
Customer completes payment on Stripe-hosted page
        │
        ▼
Stripe sends checkout.session.completed webhook to POST /webhooks/stripe
        │
        ▼
Webhook Lambda:
  1. Verifies Stripe signature
  2. Retrieves full session (including shipping address)
  3. Writes Order to DynamoDB (status: "paid")
  4. Triggers fulfillment (future: calls provider API)
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| Stripe Checkout (hosted page) | Eliminates PCI scope. No card data touches our infrastructure. |
| Server-side price enforcement | Frontend sends product IDs + quantities only. Lambda looks up real prices from DynamoDB. Prevents price manipulation. |
| Webhook as source of truth for orders | Orders are only created after confirmed payment. No "pending" orders that might never pay. |
| Idempotency on webhook | Use `stripeSessionId` as idempotency key — if an order with that session already exists, skip creation. |

### Stripe resources needed

| Resource | Purpose |
|----------|---------|
| API key (secret) | Server-side session creation |
| Publishable key | Frontend redirect (not secret) |
| Webhook signing secret | Verify webhook authenticity |
| Webhook endpoint | Register `checkout.session.completed` and `checkout.session.expired` |

### Security

- Secret key and webhook secret stored in AWS Secrets Manager (not environment variables, not source code).
- Publishable key can be in environment variable or baked into frontend build.
- Webhook endpoint validates `Stripe-Signature` header before processing.

---

## 4. Order Lifecycle

### State machine

```
                ┌──────────────────────────────────────────────────────────┐
                │                                                          │
    ┌───────┐   │   ┌───────────┐   ┌───────────────┐   ┌─────────┐   ┌──▼───────┐
    │ (new) │──▶│   │   paid    │──▶│  submitted    │──▶│ shipped │──▶│delivered │
    └───────┘   │   └─────┬─────┘   └───────┬───────┘   └─────────┘   └──────────┘
                │         │                  │
                │         ▼                  ▼
                │   ┌───────────┐     ┌───────────┐
                │   │  failed   │     │  failed   │
                │   └───────────┘     └───────────┘
                └──────────────────────────────────────────────────────────┘
```

### State definitions

| State | Meaning | Trigger |
|-------|---------|---------|
| `paid` | Stripe confirmed payment. Order recorded in DynamoDB. | `checkout.session.completed` webhook |
| `submitted` | Order sent to fulfillment provider. | Fulfillment API call returns success |
| `in_production` | Provider confirmed the order is being manufactured. | Provider webhook/poll (future) |
| `shipped` | Provider shipped the product. Tracking number available. | Provider webhook/poll (future) |
| `delivered` | Package delivered to customer. | Carrier confirmation (future) |
| `failed` | Something went wrong (payment dispute, fulfillment rejection). | Various |

### Transitions

- `paid → submitted`: Automatic. The webhook Lambda that creates the order immediately attempts to submit to the fulfillment provider. If the provider integration isn't built yet, the order stays in `paid` and a manual process handles it.
- `submitted → in_production → shipped → delivered`: Driven by the fulfillment provider's callbacks (webhook or polling).
- `Any → failed`: Triggered by payment disputes (Stripe webhook) or fulfillment failures.

### Provider-agnostic design

The fulfillment submission is isolated in a single function: `submitToFulfillment(order)`. Today this function is a no-op that logs the order. When a provider is selected, only this function changes. The rest of the order lifecycle is provider-independent.

---

## 5. Frontend Architecture

### Technology

- **Framework:** Astro v4+
- **Interactive islands:** React (via `@astrojs/react`)
- **Styling:** TBD (Tailwind CSS is the likely choice for utility-first speed)
- **Build output:** Static HTML/CSS/JS → deployed to S3

### Page structure

```
/                       → Catalog page (infinite scroll grid of products)
/products/:productId    → Product detail page (template, filled with product data)
/cart                   → Cart page (React island, client-side state)
/order-confirmed        → Post-purchase confirmation (reads session_id from URL)
```

### Data flow

```
Build time (Astro):
  1. Astro calls GET /products during build
  2. Generates static HTML for catalog page and each product detail page
  3. Product images served from CloudFront (origin: S3 media bucket)

Runtime (React islands):
  1. Cart state managed in localStorage (no backend cart)
  2. "Add to cart" button updates localStorage + React state
  3. "Checkout" button calls POST /checkout with cart contents
  4. Redirect to Stripe Checkout URL
```

### Island boundaries

| Component | Type | Reason |
|-----------|------|--------|
| Product grid | Static (Astro) | No interactivity needed — just HTML |
| Product detail content | Static (Astro) | Same — static rendering |
| "Add to cart" button | React island | Needs client-side state interaction |
| Cart page | React island | Dynamic — reads/writes localStorage, calls checkout API |
| Checkout button | React island (within cart) | Triggers API call |

### Build trigger

When a product is added/updated in DynamoDB, a rebuild of the static site is needed. Options (evaluated in CI/CD section):

1. Manual: operator runs deploy command
2. Automated: DynamoDB Stream → Lambda → triggers GitHub Actions / CodePipeline build

Start with option 1. Automate when the manual step becomes friction.

---

## 6. Infrastructure (SAM)

### Resources

| Resource | Logical name | Purpose |
|----------|-------------|---------|
| DynamoDB table | `TeeshArtData` | Single-table for products + orders |
| S3 bucket (static) | `TeeshArtStatic` | Hosts built Astro site |
| S3 bucket (media) | `TeeshArtMedia` | Product images |
| CloudFront distribution | `TeeshArtCDN` | Serves static site + media, terminates TLS |
| API Gateway (HTTP API) | `TeeshArtApi` | Routes API requests to Lambda |
| Lambda: get-products | `GetProductsFunction` | Serves product data |
| Lambda: checkout | `CheckoutFunction` | Creates Stripe sessions |
| Lambda: webhook | `WebhookFunction` | Processes Stripe webhooks |
| IAM role | `TeeshArtLambdaRole` | Scoped permissions for Lambda execution |
| Secrets Manager | `TeeshArtStripeSecrets` | Stripe API key + webhook secret |

### IAM permissions (least-privilege)

```yaml
# teesh-art-lambda-role
Policies:
  - DynamoDB:
      - dynamodb:GetItem, dynamodb:Query (all functions)
      - dynamodb:PutItem, dynamodb:UpdateItem (webhook function only)
  - SecretsManager:
      - secretsmanager:GetSecretValue (checkout + webhook functions)
  - S3:
      - s3:GetObject on teesh-art-media/* (get-products for signed URLs, if needed)
  - CloudWatch Logs:
      - logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents
```

### Lambda configuration

| Function | Runtime | Memory | Timeout | Trigger |
|----------|---------|--------|---------|---------|
| get-products | Node.js 20.x | 128 MB | 10s | API Gateway GET /products, GET /products/{id} |
| checkout | Node.js 20.x | 128 MB | 15s | API Gateway POST /checkout |
| webhook | Node.js 20.x | 128 MB | 30s | API Gateway POST /webhooks/stripe |

### Environment variables

| Variable | Source | Functions |
|----------|--------|-----------|
| `TABLE_NAME` | SAM parameter | All |
| `STRIPE_SECRET_ARN` | Secrets Manager ARN | checkout, webhook |
| `MEDIA_BUCKET` | SAM parameter | get-products |
| `SITE_URL` | SAM parameter | checkout (for success/cancel URLs) |

### SAM template structure

```
teesh-art/
├── template.yaml          # SAM template (all resources)
├── src/
│   ├── functions/
│   │   ├── get-products/  # Lambda handler + deps
│   │   ├── checkout/      # Lambda handler + deps
│   │   └── webhook/       # Lambda handler + deps
│   └── frontend/          # Astro project
├── docs/
│   ├── HLD.md
│   └── LLD.md
└── scripts/
    └── seed-product.ts    # Script to add products to DynamoDB
```

---

## 7. CI/CD Pipeline

### Tool: GitHub Actions

Chosen for simplicity — repo is already on GitHub, no additional service to configure.

### Workflows

#### 1. `deploy-infra.yml` — Infrastructure deployment

**Trigger:** Push to `main` that modifies `template.yaml` or `src/functions/**`

**Steps:**
1. Checkout code
2. Install Node.js dependencies for each Lambda function
3. `sam build`
4. `sam deploy --no-confirm-changeset --stack-name teesh-art`
5. Output API Gateway URL

#### 2. `deploy-site.yml` — Frontend deployment

**Trigger:** Push to `main` that modifies `src/frontend/**`, OR manual dispatch (for product catalog changes)

**Steps:**
1. Checkout code
2. Install frontend dependencies
3. Fetch product data from API (build-time data fetching)
4. `npm run build` (Astro generates static site)
5. Sync `dist/` to S3 static bucket
6. Invalidate CloudFront cache

#### 3. `test.yml` — PR validation

**Trigger:** Pull request to `main`

**Steps:**
1. Lint (ESLint)
2. Type check (tsc --noEmit)
3. Unit tests (Vitest)

### Secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `AWS_ACCESS_KEY_ID` | SAM deploy |
| `AWS_SECRET_ACCESS_KEY` | SAM deploy |
| `AWS_REGION` | Deployment target |

Future improvement: Replace static credentials with OIDC (OpenID Connect) federation for GitHub Actions → AWS. No long-lived keys.

---

## 8. Monitoring & Alerting

### Logging

All Lambda functions log structured JSON to CloudWatch Logs:

```json
{
  "level": "info",
  "function": "teesh-art-checkout",
  "requestId": "abc-123",
  "action": "create_checkout_session",
  "productIds": ["tee-001"],
  "totalCents": 2500
}
```

Log groups follow the pattern: `/aws/lambda/teesh-art-<function-name>`

### Metrics to watch

| Metric | Source | Alarm threshold |
|--------|--------|-----------------|
| Lambda errors (5xx) | CloudWatch Lambda metrics | > 3 in 5 minutes |
| Lambda duration | CloudWatch Lambda metrics | p95 > 5s (indicates cold start or downstream issue) |
| API Gateway 4xx rate | CloudWatch APIGW metrics | > 50% of requests (indicates broken client or attack) |
| DynamoDB throttling | CloudWatch DynamoDB metrics | Any throttled requests |
| Stripe webhook failures | Application logs (structured) | Any failed verification |

### Alerting

**Phase 1 (launch):** CloudWatch Alarms → SNS → Email notification.

**Phase 2 (scale):** Add a dashboard in CloudWatch with key metrics. Consider PagerDuty or Opsgenie if uptime SLA matters.

### What we don't monitor (yet)

- Frontend performance (add once site is live — consider CloudWatch RUM or a lightweight alternative)
- Business metrics (daily orders, revenue) — derive from DynamoDB queries when needed
- Fulfillment provider health — depends on provider selection

---

## 9. Cost Model

### Fixed costs (monthly, pre-revenue)

| Resource | Cost | Notes |
|----------|------|-------|
| S3 (static site) | ~$0.50 | Negligible storage + requests |
| S3 (media) | ~$0.50 | Scales with number of product images |
| CloudFront | ~$1.00 | First 1TB free tier; minimal traffic at launch |
| DynamoDB (on-demand) | $0 | Free tier covers 25 WCU / 25 RCU |
| Lambda | $0 | Free tier covers 1M requests + 400K GB-seconds/month |
| API Gateway | $0 | First 1M requests free (HTTP API) |
| Secrets Manager | ~$0.40 | $0.40/secret/month |
| **Total pre-revenue** | **~$2.50/month** | |

### Variable costs (per transaction)

Assuming a $25 retail shirt:

| Component | Cost | Notes |
|-----------|------|-------|
| Stripe fee | $1.03 | 2.9% + $0.30 |
| Fulfillment (shirt + print) | ~$11–16 | Provider-dependent; Printful Bella+Canvas is ~$11.69 |
| Shipping | ~$4–5 | Domestic US, passed to customer or absorbed |
| Lambda + API GW per order | < $0.01 | Negligible |
| **Margin per shirt (free shipping)** | **~$8–12** | 32–48% depending on provider |
| **Margin per shirt (customer pays ship)** | **~$12–13** | ~49–52% |

### Break-even analysis

| Monthly fixed costs | ~$2.50 |
|---|---|
| Margin per unit (conservative) | $8 |
| Break-even volume | 1 order/month |

The infrastructure cost is effectively zero at low volume. The real cost is your time designing shirts and the Stripe per-transaction fee.

### Scaling considerations

| Threshold | What changes | Action |
|-----------|-------------|--------|
| 100 orders/month | Nothing technical. Fulfillment logistics may need attention. | Monitor fulfillment SLA. |
| 1,000 orders/month | DynamoDB exits free tier (~$5/mo). Lambda still in free tier. | Review on-demand vs. provisioned capacity. |
| 10,000 orders/month | CloudFront costs rise (~$10–20/mo). May want reserved capacity. | Evaluate CloudFront price class, caching headers. |
| 100,000 orders/month | You have a real business. Re-evaluate everything. | Consider dedicated infrastructure review. |

### Cost risks

| Risk | Mitigation |
|------|-----------|
| DynamoDB hot partition | Single-table design with well-distributed keys. On-demand mode absorbs bursts. |
| CloudFront bill spike (viral traffic) | Price class restriction (PriceClass_100 = US/EU only). Budget alarm in AWS. |
| Lambda cold starts impacting UX | Minimal bundle size. Consider provisioned concurrency if checkout latency matters. |
| Stripe disputes | Fourthwall-style "merchant of record" not available; we handle disputes. Budget $20/dispute fee. |

---

## Appendix: What's deferred

| Topic | Blocked on |
|-------|-----------|
| Fulfillment provider integration | Provider selection |
| Product variants (size, color) | Scope decision — MVP may be one-size prints |
| Customer accounts / order history | Not needed for MVP |
| Admin UI for product management | CLI/script approach first |
| Custom domain (teesh-art.com) | Domain purchase + ACM certificate |
| Email notifications (order confirmation, shipping) | SES setup, template design |
| Analytics / conversion tracking | Post-launch priority |
