import { describe, it, expect } from 'vitest';

const API_URL = process.env.TEST_API_URL || 'https://73ei0iwg46.execute-api.us-east-1.amazonaws.com/prod';

const headers = {
  'Content-Type': 'application/json',
  Origin: 'https://teesh-art.com',
};

describe('POST /checkout', () => {
  it('returns 200 with a Stripe checkoutUrl for valid items', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [{ productId: 'test-tee-001', size: 'M', quantity: 1 }] }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('checkoutUrl');
    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);
  });

  it('returns 400 for an invalid productId', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [{ productId: 'does-not-exist', size: 'M', quantity: 1 }] }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing size', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [{ productId: 'test-tee-001', quantity: 1 }] }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/size/i);
  });

  it('returns 400 for invalid size code', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [{ productId: 'test-tee-001', size: 'XXL', quantity: 1 }] }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/size/i);
  });

  it('returns 400 for unavailable size', async () => {
    // test-tee-002 has XL unavailable per seed data
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [{ productId: 'test-tee-002', size: 'XL', quantity: 1 }] }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });

  it('returns 400 for an empty items array', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no body is provided', async () => {
    const res = await fetch(`${API_URL}/checkout`, {
      method: 'POST',
      headers,
    });

    expect(res.status).toBe(400);
  });
});
