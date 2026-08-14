import { describe, it, expect } from 'vitest';

const API_URL = process.env.TEST_API_URL || 'https://73ei0iwg46.execute-api.us-east-1.amazonaws.com/prod';

describe('GET /products', () => {
  it('returns 200 with a products array', async () => {
    const res = await fetch(`${API_URL}/products`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('products');
    expect(Array.isArray(body.products)).toBe(true);
  });

  it('returns at least one product with required fields', async () => {
    const res = await fetch(`${API_URL}/products`);
    const body = await res.json();

    expect(body.products.length).toBeGreaterThan(0);

    const product = body.products[0];
    expect(product).toHaveProperty('productId');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('priceCents');
    expect(product).toHaveProperty('currency');
    expect(product).toHaveProperty('images');
  });
});

describe('GET /products/:id', () => {
  it('returns 200 with the correct product for test-tee-001', async () => {
    const res = await fetch(`${API_URL}/products/test-tee-001`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.productId).toBe('test-tee-001');
  });

  it('returns 404 for a nonexistent product', async () => {
    const res = await fetch(`${API_URL}/products/nonexistent`);
    expect(res.status).toBe(404);
  });
});
