/**
 * Seed script — writes 6 products with size variants to DynamoDB.
 * Uses PutCommand to overwrite existing items (delete-and-reseed).
 *
 * Usage:
 *   AWS_PROFILE=cairn npx tsx scripts/seed-product.ts
 *
 * Environment variables:
 *   TABLE_NAME   — DynamoDB table name (default: teesh-art-data)
 *   AWS_PROFILE  — AWS credentials profile (or use --profile flag)
 *   AWS_REGION   — AWS region (or use --region flag)
 *
 * Flags:
 *   --region <region>   — AWS region (default: us-east-1)
 *   --profile <profile> — AWS credentials profile
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--region" && args[i + 1]) {
      result.region = args[++i];
    } else if (args[i] === "--profile" && args[i + 1]) {
      result.profile = args[++i];
    }
  }
  return result;
}

const products = [
  {
    productId: "test-tee-001",
    name: "Neon Skull Tee",
    description: "A glowing skull design on premium black cotton.",
    priceCents: 2500,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/111/0f0?text=Neon+Skull"],
  },
  {
    productId: "test-tee-002",
    name: "Vaporwave Sunset",
    description: "Retro gradient sunset with palm silhouettes.",
    priceCents: 2800,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: false } },
    images: ["https://placehold.co/600x600/301934/ff6fd8?text=Vaporwave"],
  },
  {
    productId: "test-tee-003",
    name: "Minimal Cat",
    description: "Single-line cat illustration on white.",
    priceCents: 2500,
    sizes: { S: { available: false }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/fff/222?text=Cat"],
  },
  {
    productId: "test-tee-004",
    name: "Glitch Grid",
    description: "Digital artifact pattern in cyan and magenta.",
    priceCents: 3000,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/0a0a2a/0ff?text=Glitch"],
  },
  {
    productId: "test-tee-005",
    name: "Mountain Line",
    description: "Continuous line drawing of a mountain range.",
    priceCents: 2700,
    sizes: { S: { available: true }, M: { available: false }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/f5f0e8/333?text=Mountain"],
  },
  {
    productId: "test-tee-006",
    name: "404 Tee",
    description: "Design not found.",
    priceCents: 3200,
    sizes: { S: { available: false }, M: { available: false }, L: { available: false }, XL: { available: false } },
    images: ["https://placehold.co/600x600/333/c00?text=404"],
  },
];

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const region = flags.region ?? process.env.AWS_REGION ?? "us-east-1";
  const tableName = process.env.TABLE_NAME ?? "teesh-art-data";

  const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = { region };
  if (flags.profile) {
    process.env.AWS_PROFILE = flags.profile;
  }

  const client = new DynamoDBClient(clientConfig);
  const docClient = DynamoDBDocumentClient.from(client);

  const now = new Date().toISOString();

  for (const product of products) {
    const item = {
      PK: `PRODUCT#${product.productId}`,
      SK: "METADATA",
      GSI1PK: "PRODUCTS",
      GSI1SK: now,
      productId: product.productId,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      currency: "usd",
      images: product.images,
      sizes: product.sizes,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );

    console.log(`✓ Seeded: ${product.productId} — ${product.name}`);
  }

  console.log(`\n✓ All ${products.length} products seeded → ${tableName} (${region})`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
