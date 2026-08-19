# teesh-art — High-Level Design

## What is teesh-art?

teesh-art is an automated t-shirt storefront. A single operator (you) adds designs to a catalog. Customers browse, purchase, and receive printed shirts — with no manual intervention between "customer clicks buy" and "shirt ships."

**Live at:** https://teesh-art.com

## How it works — the customer journey

```
┌─────────────┐     ┌─────────────────┐     ┌───────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Customer   │────▶│  Browse catalog  │────▶│  View product │────▶│  Cart/Checkout  │────▶│  Order lands │
│  arrives    │     │  (grid layout)   │     │  (detail page) │     │  (Stripe)       │     │  at printer  │
└─────────────┘     └─────────────────┘     └───────────────┘     └─────────────────┘     └──────────────┘
```

1. **Browse** — The customer lands on the catalog page showing all available designs in a grid.
2. **Select** — Clicking a design opens a product detail page (images, description, size/price).
3. **Purchase** — The customer adds to cart, proceeds to checkout via Stripe Checkout.
4. **Confirm** — On successful payment, the customer sees an order-confirmed page and receives a confirmation email (from orders@teesh-art.com via SES).
5. **Fulfill** — A successful payment triggers a fulfillment request to a print-on-demand provider, who prints and ships the shirt directly to the customer. *(Currently a no-op stub — fulfillment provider TBD.)*

## How it works — the operator journey

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Add design data │────▶│  Trigger rebuild  │────▶│  Site updated    │
│  to database     │     │  (automated)      │     │  within seconds  │
└──────────────────┘     └───────────────────┘     └──────────────────┘
```

Adding a new product means writing a record to the database and uploading images. The site rebuilds automatically, and the new design appears in the catalog — no code changes required.

## Architecture overview

```
                         ┌──────────────────────────────────────┐
                         │    CloudFront (CDN + TLS)            │
                         │    teesh-art.com                     │
                         │    Custom error responses:           │
                         │      403/404 → /404.html            │
                         └────────────────┬─────────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                    ┌─────────▼────────┐   ┌─────────▼──────────┐
                    │   S3 (static     │   │  API Gateway (HTTP) │
                    │   site assets)   │   │                     │
                    └──────────────────┘   └─────────┬───────────┘
                                                     │
                                          ┌──────────┴──────────┐
                                          │                     │
                                ┌─────────▼───────┐   ┌────────▼────────┐
                                │  Lambda:        │   │  Lambda:         │
                                │  checkout/      │   │  catalog/product │
                                │  webhook        │   │                  │
                                └────────┬────────┘   └────────┬─────────┘
                                         │                     │
                         ┌───────────────┼─────────────┐       │
                         │               │             │       │
               ┌─────────▼────┐  ┌───────▼──────┐  ┌──▼──────────────┐
               │  Stripe API  │  │  Fulfillment │  │  DynamoDB       │
               │  (payments)  │  │  Provider    │  │  (products,     │
               └──────────────┘  │  (no-op stub)│  │   orders)       │
                                 └──────────────┘  └─────────────────┘
                                                            │
                                ┌────────────────────────────┘
                                │
                      ┌─────────▼────────┐
                      │  SES             │
                      │  (order emails   │
                      │  from orders@    │
                      │  teesh-art.com)  │
                      └──────────────────┘
```

### Layer breakdown

| Layer | Technology | Role |
|-------|-----------|------|
| **CDN** | CloudFront | Serves static site globally, terminates TLS for teesh-art.com, caches assets, custom error responses (403/404 → /404.html) |
| **DNS + TLS** | Route 53 + ACM | Custom domain routing and certificate management |
| **Static hosting** | S3 | Stores the built Astro site (HTML, CSS, JS, images) |
| **API** | API Gateway (HTTP API) | Routes checkout and catalog requests to Lambda functions |
| **Compute** | Lambda (Node.js/TypeScript) | Handles checkout sessions, webhook processing, catalog queries |
| **Data** | DynamoDB | Stores product catalog and order records; PITR enabled (35-day recovery) |
| **Payments** | Stripe | Processes payments via hosted Checkout Sessions; webhook for order confirmation |
| **Email** | SES | Sends order confirmation emails from orders@teesh-art.com |
| **Fulfillment** | Print-on-demand provider (TBD) | Prints and ships the physical product (currently a no-op stub) |
| **Frontend** | Astro + React islands | Static-generated catalog and pages; React components for cart and checkout interactions |
| **IaC** | AWS SAM | Defines and deploys all AWS resources as code |
| **CI/CD** | GitHub Actions | Automated deploy (infra + site) and test pipelines |
| **Monitoring** | CloudWatch + SNS | Alarms on Lambda errors, API 5xx, DynamoDB throttle, checkout duration → email |

## Frontend pages

| Page | Purpose |
|------|---------|
| Catalog | Product grid — main landing page |
| Product detail | Individual design view with images, description, sizing |
| Cart | Review items before checkout |
| Order confirmed | Post-purchase confirmation |
| 404 | Custom not-found page (served by CloudFront error response) |
| Error | Generic error state |
| Refund policy | Legal — linked from site footer |
| Privacy policy | Legal — linked from site footer |
| Terms of service | Legal — linked from site footer |

All pages include a site footer with links to policy pages.

## Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Static site generation | Astro | Catalog changes infrequently; static pages are fast, cheap, and cacheable. No server needed for page rendering. |
| Interactive components | React islands | Cart and checkout require client-side state. Islands pattern ships JS only where needed. |
| Payment processor | Stripe Checkout | Hosted payment page eliminates PCI scope. Simple API. Extensible to subscriptions and marketplace payouts later. |
| Database | DynamoDB | Schemaless; pay-per-request pricing suits low/bursty traffic. PITR provides 35-day backup window. |
| IaC | SAM | Lightest tool for Lambda + API Gateway + DynamoDB. Deploys via CloudFormation under the hood. |
| Fulfillment | Pluggable provider | Architecture doesn't hard-code a printer. Provider is selected at integration time and called via a Lambda. |
| Email | SES | Native AWS integration, no additional vendor. Domain-verified sending from orders@teesh-art.com. |
| CI/CD | GitHub Actions | Three workflows: `deploy-infra.yml` (SAM stack), `deploy-site.yml` (frontend to S3 + invalidation), `test.yml` (API + E2E tests). |
| Monitoring | CloudWatch Alarms → SNS | Catches Lambda errors, API 5xx responses, DynamoDB throttling, and slow checkouts. Alerts delivered via email. |
| Budget control | AWS Budgets | $25/month budget with email alerts at 80% and 100% thresholds. |

## CI/CD

Three GitHub Actions workflows:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `deploy-infra.yml` | Push to main (infra changes) | `sam build` + `sam deploy` |
| `deploy-site.yml` | Push to main (frontend changes) | Astro build → S3 sync → CloudFront invalidation |
| `test.yml` | Push / PR | Runs API tests (Vitest) and E2E tests (Playwright) |

## Monitoring & alerting

| Alarm | Condition | Action |
|-------|-----------|--------|
| Lambda errors | Any invocation error | SNS → email |
| API Gateway 5xx | 5xx response count > 0 | SNS → email |
| DynamoDB throttle | Throttled requests > 0 | SNS → email |
| Checkout duration | P95 latency exceeds threshold | SNS → email |

All alarms route through an SNS topic that delivers to the operator's email.

## Data durability

DynamoDB Point-in-Time Recovery (PITR) is enabled, providing continuous backups with a 35-day recovery window. Any table state within that window can be restored to a new table.

## What this design does NOT cover (deferred)

- Specific DynamoDB table schema and access patterns (covered in LLD)
- Lambda function contracts and error handling (covered in LLD)
- Fulfillment provider selection and API integration (Phase 3 — research in progress)
- Authentication (if an admin interface is added later)
- SES production access (currently in sandbox mode — must request before go-live with real customers)
- Product variants (sizes, colors) beyond basic sizing
- SEO optimization and analytics (Phase 5)

## Resource naming

All AWS resources follow the prefix convention: `teesh-art-*`

Examples: `teesh-art-data` (DynamoDB), `teesh-art-static-*` (S3), `teesh-art-api` (API Gateway), `teesh-art-TeeshArtCheckout-*` (Lambda).

## Cost profile (estimated, at low volume)

| Resource | Free tier / low-traffic cost |
|----------|------------------------------|
| S3 + CloudFront | ~$1–3/month for a small static site with custom domain |
| DynamoDB (on-demand + PITR) | Free tier covers 25 RCU/WCU; PITR adds ~$0.20/GB/month. Effectively < $1 at low volume |
| Lambda | Free tier covers 1M requests/month; effectively $0 at low volume |
| API Gateway | $1 per million requests; effectively $0 at low volume |
| SES | $0.10 per 1,000 emails; effectively $0 at low volume |
| Route 53 | $0.50/month (hosted zone) + negligible query cost |
| CloudWatch Alarms | ~$0.40/month (4 alarms × $0.10) |
| Stripe | 2.9% + $0.30 per transaction (no monthly fee) |
| **Total (pre-revenue)** | **< $5/month** |
| **Budget alert** | **$25/month threshold (alerts at 80% / 100%)** |

Costs scale linearly with traffic and transactions. The expensive part is Stripe's per-transaction fee, not AWS infrastructure.
