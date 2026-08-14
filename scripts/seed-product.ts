/**
 * Seed script — writes a test product to DynamoDB.
 *
 * Usage:
 *   npx tsx scripts/seed-product.ts
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

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const region = flags.region ?? process.env.AWS_REGION ?? "us-east-1";
  const tableName = process.env.TABLE_NAME ?? "teesh-art-data";

  const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = { region };
  if (flags.profile) {
    // Setting AWS_PROFILE for the credential provider chain
    process.env.AWS_PROFILE = flags.profile;
  }

  const client = new DynamoDBClient(clientConfig);
  const docClient = DynamoDBDocumentClient.from(client);

  const now = new Date().toISOString();

  const item = {
    PK: "PRODUCT#test-tee-001",
    SK: "METADATA",
    GSI1PK: "PRODUCTS",
    GSI1SK: now,
    productId: "test-tee-001",
    name: "Test Tee",
    description: "A minimal test product for validating the purchase flow.",
    priceCents: 50,
    currency: "usd",
    images: ["https://placehold.co/600x600/222/fff?text=Test+Tee"],
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

  console.log(`✓ Seeded product: ${item.productId} → ${tableName} (${region})`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
