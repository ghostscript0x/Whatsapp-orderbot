import type { Metadata } from "next";
import { ProductForm } from "@/components/products/product-form";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductForm key={id} productId={id} />;
}
