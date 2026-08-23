export interface CartItem {
  productId: string;
  size: string;
  name: string;
  priceCents: number;
  image: string;
  quantity: number;
}

export interface Product {
  productId: string;
  name: string;
  description: string;
  priceCents: number;
  images: string[];
  sizes: Record<string, { available: boolean }>;
}
