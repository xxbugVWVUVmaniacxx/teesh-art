import { useEffect, useState } from 'react';

interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  image: string;
  quantity: number;
}

const CART_KEY = 'teesh-art-cart';
const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000';

export default function CartIsland() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      setCart(JSON.parse(raw));
    }
  }, []);

  function removeItem(productId: string) {
    const updated = cart.filter((item) => item.productId !== productId);
    setCart(updated);
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
  }

  function formatPrice(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  const total = cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  async function handleCheckout() {
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Checkout failed');
      }

      const { checkoutUrl } = await res.json();
      localStorage.removeItem(CART_KEY);
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  if (cart.length === 0) {
    return <p>Your cart is empty.</p>;
  }

  return (
    <div>
      <div className="cart-items">
        {cart.map((item) => (
          <div key={item.productId} className="cart-item">
            <img
              src={item.image}
              alt={item.name}
              className="cart-item-image"
            />
            <div className="cart-item-info">
              <strong>{item.name}</strong>
              <div className="cart-item-meta">
                Qty: {item.quantity} × {formatPrice(item.priceCents)}
              </div>
            </div>
            <span className="cart-item-price">
              {formatPrice(item.priceCents * item.quantity)}
            </span>
            <button
              onClick={() => removeItem(item.productId)}
              className="cart-item-remove"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="cart-footer">
        <p className="cart-total">
          Total: {formatPrice(total)}
        </p>

        {error && (
          <p className="cart-error">{error}</p>
        )}

        <button
          onClick={handleCheckout}
          disabled={loading}
          className={`cart-checkout-btn ${loading ? 'cart-checkout-btn--loading' : ''}`}
        >
          {loading ? 'Processing...' : 'Checkout'}
        </button>
      </div>
    </div>
  );
}
