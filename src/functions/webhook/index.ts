import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import Stripe from 'stripe';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const STRIPE_SECRET_ARN = process.env.STRIPE_SECRET_ARN!;

// Cache secrets across warm invocations
let cachedSecrets: { stripeKey: string; webhookSecret: string } | null = null;

async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: STRIPE_SECRET_ARN })
  );
  const parsed = JSON.parse(result.SecretString!);
  cachedSecrets = {
    stripeKey: parsed.STRIPE_SECRET_KEY,
    webhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
  };
  return cachedSecrets;
}

function generateOrderId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'ord-';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function orderExistsForSession(stripeSessionId: string): Promise<boolean> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI-1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: 'stripeSessionId = :sid',
      ExpressionAttributeValues: {
        ':pk': 'ORDERS',
        ':sid': stripeSessionId,
      },
    })
  );
  return (result.Items?.length ?? 0) > 0;
}

function submitToFulfillment(order: Record<string, unknown>): void {
  // No-op stub — will call fulfillment provider API when one is selected
  console.log('submitToFulfillment (no-op):', JSON.stringify({ orderId: order.orderId, status: order.status }));
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const secrets = await getSecrets();
    const stripe = new Stripe(secrets.stripeKey, { apiVersion: '2025-04-30.basil' });

    // Verify webhook signature
    const signature = event.headers['stripe-signature'];
    if (!signature) {
      console.error('Missing Stripe-Signature header');
      return { statusCode: 400, body: 'Missing signature' };
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body!, 'base64').toString('utf-8')
      : event.body!;

    let stripeEvent: Stripe.Event;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, secrets.webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return { statusCode: 400, body: 'Invalid signature' };
    }

    // Handle the event
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;

      // Idempotency check
      const alreadyProcessed = await orderExistsForSession(session.id);
      if (alreadyProcessed) {
        console.log('Order already exists for session, skipping:', session.id);
        return { statusCode: 200, body: 'Already processed' };
      }

      // Retrieve full session with line items and shipping details
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items', 'collected_information'],
      });

      const now = new Date().toISOString();
      const orderId = generateOrderId();

      const items = (fullSession.line_items?.data ?? []).map((li) => ({
        name: li.description,
        quantity: li.quantity,
        priceCents: li.amount_total,
      }));

      const collectedShipping = (fullSession as any).collected_information?.shipping_details;
      const shippingAddress = collectedShipping?.address
        ? {
            name: collectedShipping.name ?? '',
            line1: collectedShipping.address.line1 ?? '',
            line2: collectedShipping.address.line2 ?? '',
            city: collectedShipping.address.city ?? '',
            state: collectedShipping.address.state ?? '',
            zip: collectedShipping.address.postal_code ?? '',
            country: collectedShipping.address.country ?? '',
          }
        : null;

      const order = {
        PK: `ORDER#${orderId}`,
        SK: 'METADATA',
        GSI1PK: 'ORDERS',
        GSI1SK: now,
        orderId,
        stripeSessionId: session.id,
        customerEmail: fullSession.customer_details?.email ?? '',
        shippingAddress,
        items,
        totalCents: fullSession.amount_total ?? 0,
        status: 'paid',
        createdAt: now,
        updatedAt: now,
      };

      await dynamoClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: order,
        })
      );

      console.log('Order created:', orderId);
      submitToFulfillment(order);
    } else {
      console.log('Unhandled event type:', stripeEvent.type);
    }

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Webhook handler error:', error);
    // Return 200 to prevent Stripe from retrying on non-retriable errors
    return { statusCode: 200, body: 'Error logged' };
  }
};
