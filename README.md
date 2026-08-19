# teesh-art

Automated t-shirt storefront. Customers browse designs, purchase via Stripe Checkout, and orders are dispatched for print-on-demand fulfillment.

**Live:** https://teesh-art.com

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Astro + React islands → S3 + CloudFront |
| Backend | Lambda + API Gateway (HTTP API) + DynamoDB + SES |
| Payments | Stripe Checkout |
| IaC | AWS SAM |
| CI/CD | GitHub Actions |
| DNS/TLS | Route 53 + ACM |

## Project structure

```
├── .github/workflows/
│   ├── deploy-infra.yml       # Backend deploy on template/function changes
│   ├── deploy-site.yml        # Frontend deploy on src/frontend changes
│   └── test.yml               # Run tests on PR/push
├── infra/
│   └── cf-index-rewrite.js    # CloudFront Function (subdir index rewrites)
├── src/
│   ├── functions/
│   │   ├── get-products/      # Lambda: product catalog
│   │   ├── checkout/          # Lambda: Stripe session creation
│   │   └── webhook/           # Lambda: Stripe webhook + order email
│   └── frontend/              # Astro static site
│       └── src/pages/
│           ├── index.astro           # Catalog grid
│           ├── products/[productId]  # Product detail
│           ├── cart.astro            # Cart view
│           ├── order-confirmed.astro # Post-purchase confirmation
│           ├── privacy.astro         # Privacy policy
│           ├── terms.astro           # Terms of service
│           ├── refund.astro          # Refund policy
│           ├── error.astro           # Error page
│           └── 404.astro             # Not found
├── scripts/
│   ├── seed-product.ts        # Seed a single product to DynamoDB
│   └── seed-products-batch.ts # Batch seed multiple products
├── tests/
│   ├── api/                   # Vitest unit/integration tests (9 tests)
│   └── e2e/                   # Playwright E2E tests (4 tests, Firefox)
├── docs/
│   ├── HLD.md                 # High-level design
│   └── LLD.md                 # Low-level design
└── template.yaml              # SAM template (all AWS resources)
```

## Development

### Prerequisites

- Node 22+
- AWS SAM CLI
- Stripe CLI (webhook forwarding)
- esbuild (bundled as devDependency)

### Frontend

```bash
cd src/frontend
npm install
npm run dev
```

### Backend

```bash
sam build
sam deploy --profile cairn --no-confirm-changeset
```

### Seed products

```bash
npx tsx scripts/seed-product.ts
npx tsx scripts/seed-products-batch.ts
```

### Deploy frontend

```bash
cd src/frontend
PUBLIC_API_URL=https://73ei0iwg46.execute-api.us-east-1.amazonaws.com/prod npm run build
aws s3 sync dist/ s3://teesh-art-static-411974344834/ --delete --profile cairn
aws cloudfront create-invalidation --distribution-id E1NGP5JN1ZI2TE --paths "/*" --profile cairn
```

## Testing

```bash
npm test          # Runs all 13 tests (API + E2E)
npm run test:api  # 9 API tests (Vitest)
npm run test:e2e  # 4 E2E tests (Playwright/Firefox)
```

## CI/CD

GitHub Actions auto-deploys on push to `main`:

- **deploy-infra.yml** — triggers on changes to `template.yaml` or `src/functions/`
- **deploy-site.yml** — triggers on changes to `src/frontend/`
- **test.yml** — runs full test suite on PR and push

## Monitoring

CloudWatch alarms → SNS → email notifications. See [LLD](docs/LLD.md) for alarm definitions and thresholds.

## Documentation

- [High-Level Design](docs/HLD.md) — architecture, decision rationale, cost profile
- [Low-Level Design](docs/LLD.md) — data model, API contracts, Stripe integration, monitoring, CI/CD
- [GitHub Project Board](https://github.com/users/radlad/projects/1) — issue tracking

## Environment variables

Copy `.env.example` → `.env`. Never commit `.env`.
