import Image from "next/image";
import type { Product } from "@/lib/products";
import { ProductArt } from "./ProductArt";

/**
 * A product's picture: its real photo (cropped to fill the box) when it has one,
 * otherwise the code-drawn illustration. The parent sets the size and must be `relative`.
 */
export function ProductImage({
  product,
  index = 0,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority,
  artClassName = "h-full w-full",
  fit = "cover",
}: {
  product: Product;
  index?: number;
  sizes?: string;
  priority?: boolean;
  artClassName?: string;
  fit?: "cover" | "contain";
}) {
  const photo = product.photos?.[index] ?? product.photos?.[0];
  if (photo) {
    return (
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={sizes}
        priority={priority}
        className={fit === "cover" ? "object-cover" : "object-contain"}
        style={{ objectPosition: photo.focus ?? "50% 50%" }}
      />
    );
  }
  return <ProductArt kind={product.kind} base={product.colors.base} accent={product.colors.accent} className={artClassName} />;
}
