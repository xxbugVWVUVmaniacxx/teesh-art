import { useState } from 'react';
import SizeSelector from './SizeSelector';
import AddToCart from './AddToCart';

interface Props {
  productId: string;
  name: string;
  priceCents: number;
  image: string;
  sizes: Record<string, { available: boolean }>;
}

const SIZE_ORDER = ['M', 'L', 'XL', 'S'] as const;

function getDefaultSize(sizes: Record<string, { available: boolean }>): string | null {
  for (const size of SIZE_ORDER) {
    if (sizes[size]?.available) return size;
  }
  return null;
}

export default function ProductActions({ productId, name, priceCents, image, sizes }: Props) {
  const [selectedSize, setSelectedSize] = useState<string | null>(() => getDefaultSize(sizes));

  return (
    <div className="product-actions">
      <SizeSelector
        sizes={sizes}
        selectedSize={selectedSize}
        onSizeChange={setSelectedSize}
      />
      <AddToCart
        productId={productId}
        name={name}
        priceCents={priceCents}
        image={image}
        selectedSize={selectedSize}
        disabled={selectedSize === null}
      />
    </div>
  );
}
