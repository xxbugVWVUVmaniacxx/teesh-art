import { useEffect, useState } from 'react';

const CART_KEY = 'teesh-art-cart';

export default function CartCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function updateCount() {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) {
        try {
          const cart = JSON.parse(raw);
          const total = cart.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
          setCount(total);
        } catch {
          setCount(0);
        }
      } else {
        setCount(0);
      }
    }

    updateCount();

    // Listen for storage changes (cross-tab) and custom events (same-tab)
    window.addEventListener('storage', updateCount);
    window.addEventListener('cart-updated', updateCount);
    return () => {
      window.removeEventListener('storage', updateCount);
      window.removeEventListener('cart-updated', updateCount);
    };
  }, []);

  if (count === 0) return <span>Cart</span>;
  return <span>Cart ({count})</span>;
}
