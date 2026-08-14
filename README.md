# teesh-art

Automated t-shirt storefront. Customers browse designs, purchase via Stripe, and orders are dispatched for print-on-demand fulfillment.

**Live:** https://teesh-art.com

## Architecture

- **Frontend:** Astro + React islands → S3 + CloudFront
- **Backend:** AWS Lambda + API Gateway (HTTP API)
- **Data:** DynamoDB (single-table design)
- **Payments:** Stripe Checkout (test mode)
- **IaC:** AWS SAM
- **Language:** TypeScript
- **DNS/TLS:** Route 53 + ACM

## Project structure

```
├── template.yaml              # SAM template (all AWS resources)
├── infra/
│   └── cf-index-rewrite.js    # CloudFront Function source
├── src/
│   ├── functions/
│   │   ├── get-products/      # Lambda: product catalog
│   │   ├── checkout/          # Lambda: Stripe session creation
│   │   └── webhook/           # Lambda: Stripe webhook processing
│   └── frontend/              # Astro + React static site
├── scripts/
│   └── seed-product.ts        # CLI tool to add products to DynamoDB
└── docs/
    ├── HLD.md                 # High-level design
    └── LLD.md                 # Low-level design
```

## Local development

```bash
# Frontend dev server
cd src/frontend
npm install
npm run dev

# Seed a test product
AWS_PROFILE=cairn npx tsx scripts/seed-product.ts
```

## Deployment

### Backend
```bash
sam build
sam deploy --profile cairn --no-confirm-changeset
```

### Frontend
```bash
cd src/frontend
PUBLIC_API_URL=https://73ei0iwg46.execute-api.us-east-1.amazonaws.com/prod npm run build
aws s3 sync dist/ s3://teesh-art-static-411974344834/ --delete --profile cairn
aws cloudfront create-invalidation --distribution-id E1NGP5JN1ZI2TE --paths "/*" --profile cairn
```

## Environment variables

Copy `.env.example` to `.env` and fill in your keys. Never commit `.env`.

## Design documents

- [High-Level Design](docs/HLD.md) — architecture overview, decision rationale, cost profile
- [Low-Level Design](docs/LLD.md) — data model, API contracts, Stripe integration, order lifecycle, infrastructure, CI/CD, monitoring, cost model
