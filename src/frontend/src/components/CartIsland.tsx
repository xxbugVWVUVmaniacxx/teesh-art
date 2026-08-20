import { useEffect, useState } from 'react';

interface CartItem {
  productId: string;
  size: string;
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
      // Filter out stale items from before size variants were added
      const parsed: CartItem[] = JSON.parse(raw);
      const valid = parsed.filter((item) => item.size);
      if (valid.length !== parsed.length) {
        localStorage.setItem(CART_KEY, JSON.stringify(valid));
        window.dispatchEvent(new Event('cart-updated'));
      }
      setCart(valid);
    }
  }, []);

  function persistCart(updated: CartItem[]) {
    setCart(updated);
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('cart-updated'));
  }

  function removeItem(productId: string, size: string) {
    const updated = cart.filter(
      (item) => !(item.productId === productId && item.size === size)
    );
    persistCart(updated);
  }

  function updateQuantity(productId: string, size: string, delta: number) {
    const updated = cart
      .map((item) => {
        if (item.productId === productId && item.size === size) {
          return { ...item, quantity: item.quantity + delta };
        }
        return item;
      })
      .filter((item) => item.quantity > 0);
    persistCart(updated);
  }

  function formatPrice(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  const total = cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  async function handleCheckout() {
    setError('');
    setLoading(true);

    if (typeof window.gtag !== 'undefined') {
      window.gtag('event', 'begin_checkout', {
        currency: 'USD',
        value: total / 100,
        items: cart.map((item) => ({
          item_id: item.productId,
          item_name: item.name,
          item_variant: item.size,
          price: item.priceCents / 100,
          quantity: item.quantity,
        })),
      });
    }

    try {
      const res = await fetch(`${API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(({ productId, size, quantity }) => ({ productId, size, quantity })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Checkout failed');
      }

      const { checkoutUrl } = await res.json();
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
          <div key={`${item.productId}::${item.size}`} className="cart-item">
            <img
              src={item.image}
              alt={item.name}
              className="cart-item-image"
            />
            <div className="cart-item-info">
              <strong>{item.name} — {item.size}</strong>
              <div className="cart-item-meta">
                <span className="cart-qty-controls">
                  <button
                    onClick={() => updateQuantity(item.productId, item.size, -1)}
                    className="cart-qty-btn"
                    aria-label={`Decrease quantity of ${item.name} ${item.size}`}
                  >
                    −
                  </button>
                  <span className="cart-qty-value">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.productId, item.size, 1)}
                    className="cart-qty-btn"
                    aria-label={`Increase quantity of ${item.name} ${item.size}`}
                  >
                    +
                  </button>
                </span>
                <span className="cart-item-unit-price">× {formatPrice(item.priceCents)}</span>
              </div>
            </div>
            <span className="cart-item-price">
              {formatPrice(item.priceCents * item.quantity)}
            </span>
            <button
              onClick={() => removeItem(item.productId, item.size)}
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
