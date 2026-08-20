import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import Stripe from 'stripe';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const STRIPE_SECRET_ARN = process.env.STRIPE_SECRET_ARN!;
const SITE_URL = process.env.SITE_URL!;

// Cache Stripe instance across warm invocations
let stripeInstance: Stripe | null = null;

async function getStripe(): Promise<Stripe> {
  if (stripeInstance) return stripeInstance;

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: STRIPE_SECRET_ARN })
  );
  const secrets = JSON.parse(result.SecretString!);
  stripeInstance = new Stripe(secrets.STRIPE_SECRET_KEY, {
    apiVersion: '2025-04-30.basil',
  });
  return stripeInstance;
}

interface CartItem {
  productId: string;
  size: string;
  quantity: number;
}

const VALID_SIZES = ['S', 'M', 'L', 'XL'] as const;

interface Product {
  productId: string;
  name: string;
  priceCents: number;
  currency: string;
  images: string[];
  sizes: Record<string, { available: boolean }>;
}

function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    // Parse request body
    if (!event.body) {
      return response(400, { error: 'Request body is required' });
    }

    const { items } = JSON.parse(event.body) as { items?: CartItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return response(400, { error: 'Items array is required and must not be empty' });
    }

    // Validate and fetch products from DynamoDB
    const products: Product[] = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity < 1) {
        return response(400, { error: `Invalid item: ${JSON.stringify(item)}` });
      }

      if (!item.size || !VALID_SIZES.includes(item.size as typeof VALID_SIZES[number])) {
        return response(400, { error: `Invalid or missing size for product ${item.productId}. Must be one of: S, M, L, XL` });
      }

      const result = await dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `PRODUCT#${item.productId}`, SK: 'METADATA' },
        })
      );

      if (!result.Item || result.Item.status !== 'active') {
        return response(400, { error: `Product not found: ${item.productId}` });
      }

      const product = result.Item as unknown as Product;

      if (!product.sizes?.[item.size]?.available) {
        return response(400, { error: `Size ${item.size} is unavailable for product ${item.productId}` });
      }

      products.push(product);
    }

    // Build Stripe line items from DB prices (never trust client prices)
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item, i) => ({
      price_data: {
        currency: products[i].currency,
        product_data: {
          name: `${products[i].name} (${item.size})`,
          images: products[i].images.length > 0 ? [products[i].images[0]] : undefined,
        },
        unit_amount: products[i].priceCents,
      },
      quantity: item.quantity,
    }));

    // Create Stripe Checkout Session
    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      success_url: `${SITE_URL}/order-confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cart`,
    });

    return response(200, { checkoutUrl: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON in request body' });
    }
    return response(500, { error: 'Internal server error' });
  }
};
