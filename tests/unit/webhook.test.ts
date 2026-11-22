// Runs the real handler and Stripe's real signature check. AWS and the Stripe API are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  secrets: vi.fn(),
  ses: vi.fn(),
  retrieve: vi.fn(),
  stripe: { real: undefined as any },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.db }) },
  PutCommand: class {
    kind = 'put';
    constructor(public input: any) {}
  },
  QueryCommand: class {
    kind = 'query';
    constructor(public input: any) {}
  },
}));
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mocks.secrets;
  },
  GetSecretValueCommand: class {
    constructor(public input: any) {}
  },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = mocks.ses;
  },
  SendEmailCommand: class {
    constructor(public input: any) {}
  },
}));
vi.mock('stripe', async (importOriginal) => {
  const RealStripe = ((await importOriginal()) as any).default;
  mocks.stripe.real = RealStripe;
  return {
    default: function (key: string, options: any) {
      const stripe = new RealStripe(key, options);
      stripe.checkout.sessions.retrieve = mocks.retrieve;
      return stripe;
    },
  };
});

const SIGNING_SECRET = 'unit-test-signing-secret';
const SESSION_ID = 'cs_unit_1';
const COMPLETED = 'checkout.session.completed';
const SUCCEEDED = 'checkout.session.async_payment_succeeded';
const FAILED = 'checkout.session.async_payment_failed';

let handler: (event: any) => Promise<any>;
let table: Map<string, any>;
let indexLags: boolean;
let pageSize: number;
let session: any;

function fakeTable(command: any) {
  const { input } = command;
  if (command.kind === 'put') {
    const key = `${input.Item.PK}|${input.Item.SK}`;
    if (input.ConditionExpression === 'attribute_not_exists(PK)' && table.has(key)) {
      throw Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      });
    }
    table.set(key, input.Item);
    return {};
  }
  if (indexLags) return { Items: [] };
  const all = [...table.values()];
  const start = input.ExclusiveStartKey?.at ?? 0;
  const end = start + pageSize;
  return {
    // Like DynamoDB, filter after paging
    Items: all
      .slice(start, end)
      .filter((item) => item.stripeSessionId === input.ExpressionAttributeValues[':sid']),
    LastEvaluatedKey: end < all.length ? { at: end } : undefined,
  };
}

function secretValue(key = 'unit-test-key', signingSecret = SIGNING_SECRET) {
  return {
    SecretString: JSON.stringify({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: signingSecret }),
  };
}

function request(type = COMPLETED, { livemode = true, base64 = false, secret = SIGNING_SECRET } = {}) {
  const payload = JSON.stringify({
    id: 'evt_unit_1',
    object: 'event',
    type,
    livemode,
    data: { object: { ...session, line_items: undefined } },
  });
  const signature = new mocks.stripe.real('unit-test-key').webhooks.generateTestHeaderString({ payload, secret });
  return {
    headers: { 'stripe-signature': signature },
    body: base64 ? Buffer.from(payload).toString('base64') : payload,
    isBase64Encoded: base64,
  };
}

const orders = () => [...table.values()];
const stripeError = (statusCode: number) => Object.assign(new Error(`Stripe ${statusCode}`), { statusCode });

async function expectRetryableFailure(event: any) {
  await expect(handler(event)).rejects.toThrow('Webhook processing failed');
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('TABLE_NAME', 'unit-test-table');
  vi.stubEnv('STRIPE_SECRET_ARN', 'unit-test-secret');
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});

  table = new Map();
  indexLags = false;
  pageSize = 100;
  session = {
    id: SESSION_ID,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 2500,
    customer_details: { email: 'buyer@example.com' },
    collected_information: {
      shipping_details: {
        name: 'Test Buyer',
        address: { line1: '1 Example St', city: 'Springfield', state: 'IL', postal_code: '00000', country: 'US' },
      },
    },
    line_items: { data: [{ description: 'Test Tee (M)', quantity: 1, amount_total: 2500 }] },
  };

  mocks.db.mockImplementation(async (command: any) => fakeTable(command));
  mocks.secrets.mockImplementation(async () => secretValue());
  mocks.ses.mockResolvedValue({});
  mocks.retrieve.mockImplementation(async () => structuredClone(session));

  ({ handler } = await import('../../src/functions/webhook/index'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('failures', () => {
  it.each([401, 429, 500, undefined])('throws when Stripe retrieve fails with %s', async (status) => {
    mocks.retrieve.mockRejectedValue(status ? stripeError(status) : new Error('socket hang up'));
    await expectRetryableFailure(request());
    expect(orders()).toHaveLength(0);
  });

  it('throws when the secret cannot be read', async () => {
    mocks.secrets.mockRejectedValue(new Error('unavailable'));
    await expectRetryableFailure(request());
  });

  it.each([
    ['API key', '', SIGNING_SECRET],
    ['signing secret', 'unit-test-key', ''],
  ])('throws when the %s is empty', async (_name, key, signingSecret) => {
    mocks.secrets.mockResolvedValue(secretValue(key, signingSecret));
    await expectRetryableFailure(request());
  });

  it('throws when the duplicate lookup fails', async () => {
    mocks.db.mockRejectedValue(new Error('throttled'));
    await expectRetryableFailure(request());
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('throws when the write fails, and the retry creates one order', async () => {
    let failed = false;
    mocks.db.mockImplementation(async (command: any) => {
      if (command.kind === 'put' && !failed) {
        failed = true;
        throw new Error('throttled');
      }
      return fakeTable(command);
    });

    await expectRetryableFailure(request());
    expect(orders()).toHaveLength(0);
    expect(mocks.ses).not.toHaveBeenCalled();

    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).toHaveBeenCalledTimes(1);
  });

  it('reads the secret again after a failure', async () => {
    mocks.retrieve.mockRejectedValueOnce(stripeError(401));
    await expectRetryableFailure(request());
    await handler(request());
    expect(mocks.secrets).toHaveBeenCalledTimes(2);
  });

  it('throws on a live session that cannot be found', async () => {
    mocks.retrieve.mockRejectedValue(stripeError(404));
    await expectRetryableFailure(request());
    expect(orders()).toHaveLength(0);
  });

  it('still uses the payload for a test-mode session that cannot be found', async () => {
    mocks.retrieve.mockRejectedValue(stripeError(404));
    expect(await handler(request(COMPLETED, { livemode: false }))).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
  });
});

describe('signature check', () => {
  it('rejects a missing signature', async () => {
    expect(await handler({ headers: {}, body: '{}' })).toMatchObject({ statusCode: 400 });
  });

  it('rejects a wrong signature', async () => {
    expect(await handler(request(COMPLETED, { secret: 'someone-else' }))).toMatchObject({ statusCode: 400 });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects an empty body without throwing (base64: %s)', async (isBase64Encoded) => {
    const event = { headers: { 'stripe-signature': 't=1,v1=x' }, isBase64Encoded };
    expect(await handler(event)).toMatchObject({ statusCode: 400 });
  });

  it('accepts a base64 body', async () => {
    expect(await handler(request(COMPLETED, { base64: true }))).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
  });
});

describe('payment status', () => {
  it('records a paid session with its details', async () => {
    expect(await handler(request())).toMatchObject({ statusCode: 200, body: 'OK' });
    expect(orders()).toEqual([
      expect.objectContaining({
        orderId: expect.stringMatching(/^ord-[0-9a-f]{20}$/),
        stripeSessionId: SESSION_ID,
        GSI1PK: 'ORDERS',
        status: 'paid',
        totalCents: 2500,
        customerEmail: 'buyer@example.com',
        items: [{ name: 'Test Tee (M)', quantity: 1, priceCents: 2500 }],
        shippingAddress: expect.objectContaining({ line1: '1 Example St', zip: '00000' }),
      }),
    ]);
  });

  it('records a session that needed no payment', async () => {
    session.payment_status = 'no_payment_required';
    session.amount_total = 0;
    await handler(request());
    expect(orders()).toHaveLength(1);
  });

  it('does not record or email an unpaid session', async () => {
    session.payment_status = 'unpaid';
    expect(await handler(request())).toMatchObject({ statusCode: 200, body: 'Awaiting payment' });
    expect(orders()).toHaveLength(0);
    expect(mocks.ses).not.toHaveBeenCalled();
  });

  it('records a delayed payment once it succeeds', async () => {
    session.payment_status = 'unpaid';
    await handler(request());
    expect(orders()).toHaveLength(0);

    session.payment_status = 'paid';
    await handler(request(SUCCEEDED));
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).toHaveBeenCalledTimes(1);
  });

  it('copes with success arriving before completion', async () => {
    await handler(request(SUCCEEDED));
    expect(orders()).toHaveLength(1);
    await handler(request(COMPLETED));
    expect(orders()).toHaveLength(1);
  });

  it('trusts the retrieved status over an out-of-date payload', async () => {
    session.payment_status = 'unpaid';
    const event = request();
    session.payment_status = 'paid';
    await handler(event);
    expect(orders()).toHaveLength(1);
  });

  it('throws if a success event is still unpaid', async () => {
    session.payment_status = 'unpaid';
    await expectRetryableFailure(request(SUCCEEDED));
    expect(orders()).toHaveLength(0);
  });

  it.each([undefined, 'something_new'])('throws on payment status %s', async (status) => {
    session.payment_status = status;
    await expectRetryableFailure(request());
    expect(orders()).toHaveLength(0);
  });

  it.each([FAILED, 'checkout.session.expired'])('creates no order for %s', async (type) => {
    expect(await handler(request(type))).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('creates one order and one email for repeated deliveries', async () => {
    await handler(request());
    expect(await handler(request())).toMatchObject({ statusCode: 200, body: 'Already processed' });
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).toHaveBeenCalledTimes(1);
  });

  it('creates one order when the index has not caught up', async () => {
    indexLags = true;
    await handler(request());
    expect(await handler(request())).toMatchObject({ statusCode: 200, body: 'Already processed' });
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).toHaveBeenCalledTimes(1);
  });

  it('creates one order for concurrent deliveries', async () => {
    indexLags = true;
    const results = await Promise.all(Array.from({ length: 5 }, () => handler(request())));
    expect(results.every((result) => result.statusCode === 200)).toBe(true);
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).toHaveBeenCalledTimes(1);
  });

  it('gives different sessions different orders', async () => {
    await handler(request());
    session.id = 'cs_unit_2';
    await handler(request());
    expect(new Set(orders().map((order) => order.orderId)).size).toBe(2);
  });

  it('finds an order with an old random ID on a later page', async () => {
    pageSize = 1;
    table.set('a', { stripeSessionId: 'cs_other_1' });
    table.set('b', { stripeSessionId: 'cs_other_2' });
    table.set('c', { stripeSessionId: SESSION_ID });
    expect(await handler(request())).toMatchObject({ statusCode: 200, body: 'Already processed' });
    expect(orders()).toHaveLength(3);
  });
});

describe('email', () => {
  it('does not fail or duplicate the order when SES rejects', async () => {
    mocks.ses.mockRejectedValue(new Error('rejected'));
    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
  });

  it('does not fail the order when the email cannot be built', async () => {
    // Corrupt the order after the write so that building the body throws
    mocks.db.mockImplementation(async (command: any) => {
      const result = fakeTable(command);
      if (command.kind === 'put') command.input.Item.items = null;
      return result;
    });
    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).not.toHaveBeenCalled();
  });

  it('gives up on a hanging SES and still succeeds', { timeout: 9000 }, async () => {
    mocks.ses.mockImplementation(
      (_command: any, options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
  });

  it('keeps the order when there is no email address', async () => {
    session.customer_details = null;
    expect(await handler(request())).toMatchObject({ statusCode: 200 });
    expect(orders()).toHaveLength(1);
    expect(mocks.ses).not.toHaveBeenCalled();
  });
});
