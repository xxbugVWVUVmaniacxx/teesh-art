# teesh-art — High-Level Design

## What is teesh-art?

teesh-art is an automated t-shirt storefront. A single operator (you) adds designs to a catalog. Customers browse, purchase, and receive printed shirts — with no manual intervention between "customer clicks buy" and "shirt ships."

## How it works — the customer journey

```
┌─────────────┐     ┌─────────────────┐     ┌───────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Customer   │────▶│  Browse catalog  │────▶│  View product │────▶│  Cart/Checkout  │────▶│  Order lands │
│  arrives    │     │  (infinite scroll)│     │  (detail page) │     │  (Stripe)       │     │  at printer  │
└─────────────┘     └─────────────────┘     └───────────────┘     └─────────────────┘     └──────────────┘
```

1. **Browse** — The customer lands on a single page showing all available designs in a scrollable grid.
2. **Select** — Clicking a design opens a product detail view (same template, different content: images, description, price).
3. **Purchase** — The customer adds to cart, enters shipping and payment info via Stripe Checkout.
4. **Fulfill** — A successful payment triggers a fulfillment request to a print-on-demand provider, who prints and ships the shirt directly to the customer.

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
                         │           CloudFront (CDN)           │
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
                                │  checkout/order │   │  catalog/product │
                                └────────┬────────┘   └────────┬─────────┘
                                         │                     │
                              ┌──────────┴──────────┐          │
                              │                     │          │
                    ┌─────────▼────────┐  ┌────────▼────┐  ┌──▼──────────┐
                    │  Stripe API      │  │  Fulfillment│  │  DynamoDB   │
                    │  (payments)      │  │  Provider   │  │  (products, │
                    └──────────────────┘  │  API (TBD)  │  │   orders)   │
                                          └─────────────┘  └─────────────┘
```

### Layer breakdown

| Layer | Technology | Role |
|-------|-----------|------|
| **CDN** | CloudFront | Serves static site globally, terminates TLS, caches assets |
| **Static hosting** | S3 | Stores the built Astro site (HTML, CSS, JS, images) |
| **API** | API Gateway (HTTP API) | Routes checkout and catalog requests to Lambda functions |
| **Compute** | Lambda (Node.js/TypeScript) | Handles checkout sessions, order creation, fulfillment dispatch |
| **Data** | DynamoDB | Stores product catalog and order records |
| **Payments** | Stripe | Processes payments via hosted Checkout Sessions |
| **Fulfillment** | Print-on-demand provider (TBD) | Prints and ships the physical product |
| **Frontend** | Astro + React islands | Static-generated catalog; React components for cart and checkout interactions |
| **IaC** | AWS SAM | Defines and deploys all AWS resources as code |

## Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Static site generation | Astro | Catalog changes infrequently; static pages are fast, cheap, and cacheable. No server needed for page rendering. |
| Interactive components | React islands | Cart and checkout require client-side state. Islands pattern ships JS only where needed. |
| Payment processor | Stripe Checkout | Hosted payment page eliminates PCI scope. Simple API. Extensible to subscriptions and marketplace payouts later. |
| Database | DynamoDB | Schemaless; pay-per-request pricing suits low/bursty traffic. Consistent with existing AWS patterns. |
| IaC | SAM | Lightest tool for Lambda + API Gateway + DynamoDB. Deploys via CloudFormation under the hood. |
| Fulfillment | Pluggable provider | Architecture doesn't hard-code a printer. Provider is selected at integration time and called via a Lambda. |

## What this design does NOT cover (deferred to LLD)

- Specific DynamoDB table schema and access patterns
- Lambda function contracts and error handling
- Stripe webhook event processing
- Fulfillment provider selection and API integration
- Build/deploy pipeline (CI/CD)
- Monitoring, alerting, and logging
- Cost modeling and scaling thresholds
- Authentication (if an admin interface is added later)

## Resource naming

All AWS resources follow the prefix convention: `teesh-art-*`

Examples: `teesh-art-products` (DynamoDB), `teesh-art-static` (S3), `teesh-art-api` (API Gateway), `teesh-art-checkout` (Lambda).

## Cost profile (estimated, at low volume)

| Resource | Free tier / low-traffic cost |
|----------|------------------------------|
| S3 + CloudFront | ~$1–3/month for a small static site |
| DynamoDB (on-demand) | Free tier covers 25 RCU/WCU; effectively $0 at low volume |
| Lambda | Free tier covers 1M requests/month; effectively $0 at low volume |
| API Gateway | $1 per million requests; effectively $0 at low volume |
| Stripe | 2.9% + $0.30 per transaction (no monthly fee) |
| **Total (pre-revenue)** | **< $5/month** |

Costs scale linearly with traffic and transactions. The expensive part is Stripe's per-transaction fee, not AWS infrastructure.
