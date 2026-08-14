# teesh-art

Automated t-shirt storefront. Customers browse designs, purchase via Stripe, and orders are dispatched for print-on-demand fulfillment.

## Architecture

- **Frontend:** Astro + React islands → S3 + CloudFront
- **Backend:** AWS Lambda + API Gateway (HTTP API)
- **Data:** DynamoDB
- **Payments:** Stripe Checkout
- **IaC:** AWS SAM
- **Language:** TypeScript

## Local development

```bash
npm install
npm run dev
```

## Deployment

```bash
sam build
sam deploy --guided
```

## Environment variables

Copy `.env.example` to `.env` and fill in your keys. Never commit `.env`.
