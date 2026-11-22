import type { Product } from './types';

// A production build must fail here: deploying without products deletes the live product pages.
export async function fetchProducts(): Promise<Product[]> {
  const url = `${import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'}/products`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { products } = await res.json();
    if (!Array.isArray(products) || products.length === 0) throw new Error('no products returned');

    return products;
  } catch (error) {
    const message = `Could not load products from ${url}: ${error}`;
    if (import.meta.env.PROD) throw new Error(message, { cause: error });

    console.warn(message);
    return [];
  }
}
