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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {cart.map((item) => (
          <div
            key={item.productId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.75rem',
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: '6px',
            }}
          >
            <img
              src={item.image}
              alt={item.name}
              style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
            />
            <div style={{ flex: 1 }}>
              <strong>{item.name}</strong>
              <div style={{ color: '#555', fontSize: '0.875rem' }}>
                Qty: {item.quantity} × {formatPrice(item.priceCents)}
              </div>
            </div>
            <span style={{ fontWeight: 600 }}>
              {formatPrice(item.priceCents * item.quantity)}
            </span>
            <button
              onClick={() => removeItem(item.productId)}
              style={{
                background: 'none',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '0.25rem 0.5rem',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e0e0e0', paddingTop: '1rem' }}>
        <p style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
          Total: {formatPrice(total)}
        </p>

        {error && (
          <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>
        )}

        <button
          onClick={handleCheckout}
          disabled={loading}
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            fontWeight: 600,
            background: loading ? '#999' : '#1a1a1a',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Processing...' : 'Checkout'}
        </button>
      </div>
    </div>
  );
}
