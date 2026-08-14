import { test, expect } from '@playwright/test';

test.describe('Checkout flow', () => {
  test('redirects to Stripe checkout', async ({ page }) => {
    await page.goto('/products/test-tee-001');

    // Wait for all Astro islands to hydrate
    await page.waitForFunction(() => {
      const islands = document.querySelectorAll('astro-island');
      return islands.length > 0 && Array.from(islands).every(i => !i.hasAttribute('ssr'));
    }, { timeout: 15000 });

    // Add to cart
    const addButton = page.getByRole('button', { name: /add to cart/i });
    await addButton.click();

    // Verify cart populated
    const cart = await page.evaluate(() => localStorage.getItem('teesh-art-cart'));
    expect(cart).not.toBeNull();

    // Go to cart
    await page.goto('/cart');

    // Wait for cart island hydration
    await page.waitForFunction(() => {
      const islands = document.querySelectorAll('astro-island');
      return islands.length > 0 && Array.from(islands).every(i => !i.hasAttribute('ssr'));
    }, { timeout: 15000 });

    // Click Checkout
    const checkoutButton = page.getByRole('button', { name: /checkout/i });
    await checkoutButton.click();

    // Wait for navigation to Stripe
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    expect(page.url()).toMatch(/^https:\/\/checkout\.stripe\.com/);
  });
});
