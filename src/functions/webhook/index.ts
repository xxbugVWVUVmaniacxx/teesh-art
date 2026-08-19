import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Stripe from 'stripe';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const sesClient = new SESClient({});

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

async function sendOrderConfirmation(order: Record<string, unknown>): Promise<void> {
  const email = order.customerEmail as string;
  if (!email) {
    console.warn('No customer email, skipping confirmation:', order.orderId);
    return;
  }

  const orderId = order.orderId as string;
  const items = order.items as Array<{ name: string; quantity: number; priceCents: number }>;
  const totalCents = order.totalCents as number;

  const itemLines = items
    .map((item) => `• ${item.name} × ${item.quantity} — $${((item.priceCents ?? 0) / 100).toFixed(2)}`)
    .join('\n');

  const textBody = [
    `Hi there!`,
    ``,
    `Your order ${orderId} has been confirmed. Here's a summary:`,
    ``,
    itemLines || '(items will appear on your receipt)',
    ``,
    `Total: $${(totalCents / 100).toFixed(2)}`,
    ``,
    `We'll send you another email once your order ships.`,
    ``,
    `Thanks for shopping with teesh-art!`,
    `— teesh-art`,
  ].join('\n');

  const htmlBody = [
    `<h2>Order Confirmed</h2>`,
    `<p>Hi there!</p>`,
    `<p>Your order <strong>${orderId}</strong> has been confirmed.</p>`,
    `<table style="border-collapse:collapse;margin:1rem 0;">`,
    ...items.map(
      (item) =>
        `<tr><td style="padding:4px 12px 4px 0;">${item.name} × ${item.quantity}</td><td style="padding:4px 0;">$${((item.priceCents ?? 0) / 100).toFixed(2)}</td></tr>`
    ),
    `<tr style="border-top:1px solid #ccc;"><td style="padding:8px 12px 4px 0;font-weight:bold;">Total</td><td style="padding:8px 0;font-weight:bold;">$${(totalCents / 100).toFixed(2)}</td></tr>`,
    `</table>`,
    `<p>We'll send you another email once your order ships.</p>`,
    `<p>Thanks for shopping with teesh-art!</p>`,
  ].join('');

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: 'orders@teesh-art.com',
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `Order Confirmed — ${orderId}` },
          Body: {
            Text: { Data: textBody },
            Html: { Data: htmlBody },
          },
        },
      })
    );
    console.log('Confirmation email sent to:', email);
  } catch (err) {
    // Don't fail the order if email fails — log and continue
    console.error('Failed to send confirmation email:', err);
  }
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

      // Retrieve full session with line items and shipping details.
      // Falls back to event data when session can't be fetched (e.g., synthetic stripe trigger events).
      let fullSession: Stripe.Checkout.Session;
      try {
        fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items', 'collected_information'],
        });
      } catch (retrieveErr: any) {
        if (retrieveErr?.statusCode === 404) {
          console.warn('Session not found via retrieve, using event payload:', session.id);
          fullSession = session;
        } else {
          throw retrieveErr;
        }
      }

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
      await sendOrderConfirmation(order);
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
