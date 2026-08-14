import { test, expect } from '@playwright/test';

test.describe('Product catalog', () => {
  test('displays products on the home page', async ({ page }) => {
    await page.goto('/');

    // Page title contains teesh-art
    await expect(page).toHaveTitle(/teesh-art/i);

    // At least one product card visible
    const cards = page.locator('a.card, [class*="card"]');
    await expect(cards.first()).toBeVisible();

    // Product card contains an image and a name
    const firstCard = cards.first();
    await expect(firstCard.locator('img')).toBeVisible();
    await expect(firstCard).toContainText(/.+/); // has text content (name)
  });

  test('has a nav bar with a cart link', async ({ page }) => {
    await page.goto('/');

    const nav = page.locator('nav');
    await expect(nav).toBeVisible();

    const cartLink = nav.locator('a[href*="cart"]');
    await expect(cartLink).toBeVisible();
  });
});
