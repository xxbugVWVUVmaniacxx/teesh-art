export interface Product {
  productId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  images: string[];
  sizes: Record<string, { available: boolean }>;
  status: 'active' | 'draft' | 'archived';
  createdAt: string;
  updatedAt: string;
}
