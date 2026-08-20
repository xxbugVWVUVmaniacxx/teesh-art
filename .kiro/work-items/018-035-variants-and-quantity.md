---
title: "Product variant support (#18) + Cart quantity controls (#35)"
status: done
issues: [18, 35]
created: 2026-08-20
---

# Product Variant Support + Cart Quantity Controls

## Overview

Add size selection (S/M/L/XL) to product detail pages and quantity adjustment controls (±) to the cart. These two features share surface area in the cart data model and are implemented together.

## Design Decisions

| Decision | Answer |
|----------|--------|
| Price model | Flat per product — `priceCents` stays top-level |
| Size codes | Fixed: S, M, L, XL (ordered) |
| `sizes` map | Availability only: `{ "S": { "available": true }, ... }` |
| Availability mutability | Will change over time (manufacturer stock) — not static config |
| Default size selection | M → L → XL → S (first available in rotation order) |
| All sizes unavailable | All pills grayed out, "Add to Cart" disabled |
| Cart item key | `productId + size` (same product, different size = separate line) |
| Sizeless cart items | Impossible by design — selector always has a value |
| Catalog card price | Shows `priceCents` directly (flat price, no "From" prefix) |
| Quantity controls | `[–] N [+]` inline in cart; decrement to 0 removes item |

## Data Model

### Product record (DynamoDB)

```json
{
  "PK": "PRODUCT#neon-skull-001",
  "SK": "METADATA",
  "GSI1PK": "PRODUCTS",
  "GSI1SK": "2026-08-20T00:00:00.000Z",
  "productId": "neon-skull-001",
  "name": "Neon Skull Tee",
  "description": "A glowing skull design on black cotton.",
  "priceCents": 2500,
  "currency": "usd",
  "images": ["https://placehold.co/600x600/222/fff?text=Neon+Skull"],
  "sizes": {
    "S":  { "available": true },
    "M":  { "available": true },
    "L":  { "available": true },
    "XL": { "available": false }
  },
  "status": "active",
  "createdAt": "2026-08-20T00:00:00.000Z",
  "updatedAt": "2026-08-20T00:00:00.000Z"
}
```

**Migration:** Remove old `priceCents`-only products and re-seed with `sizes` map included. The `priceCents` field remains at top level (unchanged key), `sizes` is added.

### Cart item (localStorage)

```ts
interface CartItem {
  productId: string;
  size: string;        // NEW — "S" | "M" | "L" | "XL"
  name: string;
  priceCents: number;
  image: string;
  quantity: number;
}
```

Cart key for deduplication: `${productId}::${size}`

## API Contract

### GET /products (list) — response unchanged structurally, adds `sizes`

```json
{
  "products": [
    {
      "productId": "neon-skull-001",
      "name": "Neon Skull Tee",
      "description": "...",
      "priceCents": 2500,
      "currency": "usd",
      "images": ["..."],
      "sizes": {
        "S": { "available": true },
        "M": { "available": true },
        "L": { "available": true },
        "XL": { "available": false }
      },
      "status": "active",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### GET /products/:id — same shape as list item (already works this way)

### POST /checkout — request body

```json
{
  "items": [
    { "productId": "neon-skull-001", "size": "M", "quantity": 1 }
  ]
}
```

**Validation rules (checkout Lambda):**
1. `size` is required and must be one of: S, M, L, XL
2. Product must exist and be active
3. `sizes[size].available` must be `true` — reject with 400 if unavailable
4. Price comes from top-level `priceCents` (not from client)

**Stripe line item name:** Include size → `"Neon Skull Tee (M)"`

## Frontend Components

### New: `SizeSelector.tsx`

```
Props:
  sizes: Record<string, { available: boolean }>
  selectedSize: string
  onSizeChange: (size: string) => void

Behavior:
  - Renders 4 pill buttons: S, M, L, XL (always in this order)
  - Available + selected: solid fill (#1a1a1a), white text
  - Available + unselected: outlined, dark text, hover highlight
  - Unavailable: light gray bg, muted text, cursor:not-allowed, aria-disabled
  - Clicking an available pill calls onSizeChange
  - Clicking an unavailable pill does nothing
```

### Updated: `AddToCart.tsx`

```
Props (changes):
  + selectedSize: string | null
  + disabled: boolean         // true when all sizes unavailable

Behavior:
  - Button disabled when selectedSize is null or disabled=true
  - Stores size in cart item
  - Cart dedup key: productId + size
  - If same product+size already in cart, increment quantity
```

### Updated: `[productId].astro`

```
Changes:
  - Pass product.sizes to a new client:load island that wraps SizeSelector + AddToCart
  - Compute default size: M → L → XL → S (first available), or null if none
  - Display price remains from product.priceCents (no change)
```

Note: Since both SizeSelector and AddToCart need shared state (selectedSize), they should be wrapped in a single React island (`ProductActions.tsx`) that manages that state internally.

### New: `ProductActions.tsx` (React island)

```
Props:
  productId: string
  name: string
  priceCents: number
  image: string
  sizes: Record<string, { available: boolean }>

Internal state:
  selectedSize: string | null (initialized via M→L→XL→S fallback)

Renders:
  <SizeSelector sizes={sizes} selectedSize={selectedSize} onSizeChange={setSelectedSize} />
  <AddToCart productId={productId} name={name} priceCents={priceCents} image={image} selectedSize={selectedSize} disabled={selectedSize === null} />
```

### Updated: `CartIsland.tsx`

```
Changes:
  - CartItem interface gains `size: string`
  - Display: "{name} — {size}" for each line item
  - Quantity controls: [–] {qty} [+] buttons per item
    - [+] increments quantity
    - [–] decrements; if qty reaches 0, remove item from cart
  - Remove button stays (instant full removal)
  - Cart dedup on checkout payload: group by productId+size
  - Update localStorage and dispatch 'cart-updated' event on every change
```

### Updated: `index.astro` (catalog)

```
Changes:
  - No structural change — price is still flat `priceCents`
  - No size selector on catalog cards (selection happens on detail page)
```

## Seed Script

Update `scripts/seed-product.ts` to seed 6 products with `sizes` maps. At least one product should have a size unavailable (to test grayed-out state). Example seed data:

```ts
const products = [
  {
    productId: "test-tee-001",
    name: "Neon Skull Tee",
    description: "A glowing skull design on premium black cotton.",
    priceCents: 2500,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/111/0f0?text=Neon+Skull"],
  },
  {
    productId: "test-tee-002",
    name: "Vaporwave Sunset",
    description: "Retro gradient sunset with palm silhouettes.",
    priceCents: 2800,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: false } },
    images: ["https://placehold.co/600x600/301934/ff6fd8?text=Vaporwave"],
  },
  {
    productId: "test-tee-003",
    name: "Minimal Cat",
    description: "Single-line cat illustration on white.",
    priceCents: 2500,
    sizes: { S: { available: false }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/fff/222?text=Cat"],
  },
  {
    productId: "test-tee-004",
    name: "Glitch Grid",
    description: "Digital artifact pattern in cyan and magenta.",
    priceCents: 3000,
    sizes: { S: { available: true }, M: { available: true }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/0a0a2a/0ff?text=Glitch"],
  },
  {
    productId: "test-tee-005",
    name: "Mountain Line",
    description: "Continuous line drawing of a mountain range.",
    priceCents: 2700,
    sizes: { S: { available: true }, M: { available: false }, L: { available: true }, XL: { available: true } },
    images: ["https://placehold.co/600x600/f5f0e8/333?text=Mountain"],
  },
  {
    productId: "test-tee-006",
    name: "404 Tee",
    description: "Design not found.",
    priceCents: 3200,
    sizes: { S: { available: false }, M: { available: false }, L: { available: false }, XL: { available: false } },
    images: ["https://placehold.co/600x600/333/c00?text=404"],
  },
];
```

Note: test-tee-005 has M unavailable (tests the fallback: M→L). test-tee-006 has all unavailable (tests fully disabled state).

## Checkout Lambda Changes

In `src/functions/checkout/index.ts`:

1. `CartItem` interface adds `size: string`
2. Validation: reject if `size` missing or not in `["S","M","L","XL"]`
3. After product fetch: check `product.sizes[item.size].available === true`, reject 400 if not
4. Stripe line item `product_data.name`: `"${product.name} (${item.size})"`
5. Price source: `product.priceCents` (unchanged)

## Webhook Impact

None. The webhook reads line items from Stripe's response (which will now say "Neon Skull Tee (M)"). The `items` array in the order record will naturally include the size in the name. No code changes needed.

## Test Updates

### API tests (Vitest)

- **Update existing:** checkout test must include `size` in request body
- **Add:** checkout with unavailable size → expect 400
- **Add:** checkout with missing size → expect 400
- **Add:** checkout with invalid size code → expect 400

### E2E tests (Playwright)

- **Update:** add-to-cart flow must select a size (or rely on default M)
- **Update:** cart test must verify size label appears
- **Add:** verify quantity +/– buttons work
- **Add:** verify decrement to 0 removes item
- **Add:** verify unavailable size pill is not clickable

## Implementation Order

1. Seed script update + re-seed DB
2. Checkout Lambda (add size validation)
3. get-products Lambda (no code change needed — sizes map passes through via `stripInternalKeys`)
4. Frontend: ProductActions.tsx (wraps SizeSelector + AddToCart)
5. Frontend: SizeSelector.tsx
6. Frontend: update AddToCart.tsx
7. Frontend: update CartIsland.tsx (size display + quantity controls)
8. Frontend: update [productId].astro (swap AddToCart for ProductActions island)
9. Update tests
10. Build, deploy, verify
