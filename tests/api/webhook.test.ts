import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'teesh-art-data';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  // AWS_PROFILE is read automatically from env
});
const docClient = DynamoDBDocumentClient.from(client);

async function getOrders() {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI-1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ORDERS' },
    }),
  );
  return result.Items || [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Stripe webhook (checkout.session.completed)', () => {
  it('creates a new order with status=paid after webhook fires', async () => {
    // Count orders before
    const ordersBefore = await getOrders();
    const countBefore = ordersBefore.length;

    // Trigger the webhook via Stripe CLI
    execSync('stripe trigger checkout.session.completed', {
      stdio: 'pipe',
      env: { ...process.env, AWS_PROFILE: 'cairn' },
    });

    // Wait for async processing
    await sleep(5000);

    // Count orders after
    const ordersAfter = await getOrders();
    const countAfter = ordersAfter.length;

    expect(countAfter).toBe(countBefore + 1);

    // Find the newest order (sort by SK descending — SK typically contains a timestamp)
    const sorted = ordersAfter.sort((a, b) => {
      const skA = a.SK || a.createdAt || '';
      const skB = b.SK || b.createdAt || '';
      return skB.localeCompare(skA);
    });

    const newestOrder = sorted[0];
    expect(newestOrder.status).toBe('paid');
  });
});
