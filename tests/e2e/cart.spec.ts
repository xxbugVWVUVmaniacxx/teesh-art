import { test, expect } from '@playwright/test';

test.describe('Cart functionality', () => {
  test('can add a product to cart and view it', async ({ page }) => {
    await page.goto('/products/test-tee-001');

    // Wait for all Astro islands to hydrate
    await page.waitForFunction(() => {
      const islands = document.querySelectorAll('astro-island');
      return islands.length > 0 && Array.from(islands).every(i => !i.hasAttribute('ssr'));
    }, { timeout: 15000 });

    // Click Add to Cart
    const addButton = page.getByRole('button', { name: /add to cart/i });
    await addButton.click();

    // Verify item was added to localStorage
    const cart = await page.evaluate(() => localStorage.getItem('teesh-art-cart'));
    expect(cart).not.toBeNull();
    const cartItems = JSON.parse(cart!);
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].productId).toBe('test-tee-001');
    expect(cartItems[0].quantity).toBe(1);
    expect(cartItems[0].priceCents).toBe(50);

    // Navigate to cart
    await page.goto('/cart');

    // Wait for cart island hydration
    await page.waitForFunction(() => {
      const islands = document.querySelectorAll('astro-island');
      return islands.length > 0 && Array.from(islands).every(i => !i.hasAttribute('ssr'));
    }, { timeout: 15000 });

    // Cart shows the product and price
    await expect(page.locator('body')).toContainText(/test tee/i, { timeout: 5000 });
    await expect(page.locator('body')).toContainText('$0.50');

    // Checkout button is visible
    const checkoutButton = page.getByRole('button', { name: /checkout/i });
    await expect(checkoutButton).toBeVisible();
  });
});
