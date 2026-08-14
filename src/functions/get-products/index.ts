import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const INTERNAL_KEYS = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;

interface Product {
  productId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  images: string[];
  status: 'active' | 'draft' | 'archived';
  createdAt: string;
  updatedAt: string;
}

function stripInternalKeys(item: Record<string, unknown>): Product {
  const cleaned = { ...item };
  for (const key of INTERNAL_KEYS) {
    delete cleaned[key];
  }
  return cleaned as unknown as Product;
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

async function listProducts(): Promise<APIGatewayProxyResultV2> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI-1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PRODUCTS' },
    }),
  );

  const products = (result.Items ?? [])
    .filter((item) => item.status === 'active')
    .map(stripInternalKeys);

  return response(200, { products });
}

async function getProduct(productId: string): Promise<APIGatewayProxyResultV2> {
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
    }),
  );

  if (!result.Item || result.Item.status !== 'active') {
    return response(404, { message: 'Product not found' });
  }

  return response(200, stripInternalKeys(result.Item));
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const productId = event.pathParameters?.productId;

    if (productId) {
      return await getProduct(productId);
    }

    return await listProducts();
  } catch (error) {
    console.error('Unhandled error', error);
    return response(500, { message: 'Internal server error' });
  }
};
