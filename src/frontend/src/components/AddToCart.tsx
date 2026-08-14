import { useState } from 'react';

interface CartItem {
  productId: string;
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
}

const CART_KEY = 'teesh-art-cart';

export default function AddToCart({ productId, name, priceCents, image }: Props) {
  const [added, setAdded] = useState(false);

  function handleClick() {
    const raw = localStorage.getItem(CART_KEY);
    const cart: CartItem[] = raw ? JSON.parse(raw) : [];

    const existing = cart.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ productId, name, priceCents, image, quantity: 1 });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cart-updated'));
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      onClick={handleClick}
      style={{
        padding: '0.75rem 1.5rem',
        fontSize: '1rem',
        fontWeight: 600,
        background: added ? '#22c55e' : '#1a1a1a',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background 0.2s',
      }}
    >
      {added ? 'Added!' : 'Add to Cart'}
    </button>
  );
}
