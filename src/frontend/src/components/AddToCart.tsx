import { useState } from 'react';

interface CartItem {
  productId: string;
  size: string;
  name: string;
  priceCents: number;
  image: string;
  quantity: number;
}

interface Props {
  productId: string;
  name: string;
  priceCents: number;
  image: string;
  selectedSize: string | null;
  disabled: boolean;
}

const CART_KEY = 'teesh-art-cart';

export default function AddToCart({ productId, name, priceCents, image, selectedSize, disabled }: Props) {
  const [added, setAdded] = useState(false);

  function handleClick() {
    if (!selectedSize || disabled) return;

    const raw = localStorage.getItem(CART_KEY);
    const cart: CartItem[] = raw ? JSON.parse(raw) : [];

    const cartKey = `${productId}::${selectedSize}`;
    const existing = cart.find((item) => `${item.productId}::${item.size}` === cartKey);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ productId, size: selectedSize, name, priceCents, image, quantity: 1 });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cart-updated'));

    if (typeof window.gtag !== 'undefined') {
      window.gtag('event', 'add_to_cart', {
        currency: 'USD',
        value: priceCents / 100,
        items: [{ item_id: productId, item_name: name, item_variant: selectedSize, price: priceCents / 100, quantity: 1 }]
      });
    }

    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const isDisabled = !selectedSize || disabled;

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className={`add-to-cart-btn ${added ? 'add-to-cart-btn--added' : ''}`}
    >
      {added ? 'Added!' : 'Add to Cart'}
    </button>
  );
}
