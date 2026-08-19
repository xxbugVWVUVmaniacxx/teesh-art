/**
 * Seed script — writes multiple test products to DynamoDB for scroll testing.
 *
 * Usage:
 *   AWS_PROFILE=cairn npx tsx scripts/seed-products-batch.ts
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const products = [
  {
    productId: "test-tee-001",
    name: "Test Tee",
    description: "A minimal test product for validating the purchase flow.",
    priceCents: 2500,
    color: "222/fff",
  },
  {
    productId: "test-tee-002",
    name: "Midnight Owl",
    description: "Hand-drawn owl design on soft black cotton.",
    priceCents: 3200,
    color: "1a1a2e/e0e0e0",
  },
  {
    productId: "test-tee-003",
    name: "Sunset Gradient",
    description: "Warm orange-to-pink fade across the chest.",
    priceCents: 2800,
    color: "f97316/fff",
  },
  {
    productId: "test-tee-004",
    name: "Circuit Board",
    description: "Abstract circuit traces on dark green.",
    priceCents: 3000,
    color: "064e3b/10b981",
  },
  {
    productId: "test-tee-005",
    name: "Ocean Wave",
    description: "Minimalist wave linework on navy blue.",
    priceCents: 2900,
    color: "1e3a5f/93c5fd",
  },
  {
    productId: "test-tee-006",
    name: "Desert Cactus",
    description: "Geometric cactus illustration on sand.",
    priceCents: 2700,
    color: "d4a373/1a1a1a",
  },
];

async function main() {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const tableName = process.env.TABLE_NAME ?? "teesh-art-data";

  const client = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(client);

  for (const product of products) {
    const now = new Date().toISOString();
    // Stagger GSI1SK so products sort in order
    await new Promise((r) => setTimeout(r, 50));

    const item = {
      PK: `PRODUCT#${product.productId}`,
      SK: "METADATA",
      GSI1PK: "PRODUCTS",
      GSI1SK: new Date().toISOString(),
      productId: product.productId,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      currency: "usd",
      images: [`https://placehold.co/800x800/${product.color}?text=${encodeURIComponent(product.name)}`],
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

    console.log(`✓ Seeded: ${product.productId} — ${product.name} ($${(product.priceCents / 100).toFixed(0)})`);
  }

  console.log(`\n✓ ${products.length} products seeded to ${tableName}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
