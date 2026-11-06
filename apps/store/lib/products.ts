export type ArtKind = "hoodie" | "tee" | "cap" | "stickers" | "box";

export interface Product {
  id: string;
  name: string;
  /** USDT, 2 decimals */
  price: string;
  kind: ArtKind;
  /** main garment colour + accent for the illustration */
  colors: { base: string; accent: string };
  sizes: string[] | null;
  tagline: string;
  description: string;
  /** Subscription product: bought on /box instead of the cart */
  subscription?: { interval: string };
}

export const products: Product[] = [
  {
    id: "builder-hoodie",
    name: "Builder Hoodie",
    price: "25.00",
    kind: "hoodie",
    colors: { base: "#1f2233", accent: "#fbbf24" },
    sizes: ["S", "M", "L", "XL", "2XL"],
    tagline: "Heavyweight fleece for late-night shipping",
    description:
      "A heavyweight fleece hoodie with an embroidered sparkle on the chest. Warm enough for an air-conditioned hacker hall at 4am.",
  },
  {
    id: "ship-it-tee",
    name: "Ship-It Tee",
    price: "12.00",
    kind: "tee",
    colors: { base: "#f4f1e8", accent: "#6d5dfc" },
    sizes: ["S", "M", "L", "XL", "2XL"],
    tagline: "Soft cotton, loud message",
    description: "A soft cotton tee with a hand-drawn \"ship it\" print on the back. Pre-shrunk, so it survives the hotel laundry.",
  },
  {
    id: "counter-cap",
    name: "Counter Cap",
    price: "10.00",
    kind: "cap",
    colors: { base: "#6d5dfc", accent: "#ffffff" },
    sizes: null,
    tagline: "One size, adjustable strap",
    description: "A washed cotton dad cap with an embroidered sparkle. One size fits most, adjustable strap.",
  },
  {
    id: "sticker-pack",
    name: "Sticker Pack",
    price: "3.00",
    kind: "stickers",
    colors: { base: "#fbbf24", accent: "#6d5dfc" },
    sizes: null,
    tagline: "Ten holographic stickers",
    description: "Ten holographic vinyl stickers for your laptop lid. Also sold at the counter: scan the QR to pay.",
  },
  {
    id: "builder-box",
    name: "Builder Box",
    price: "15.00",
    kind: "box",
    colors: { base: "#f2b8a2", accent: "#4f46e5" },
    sizes: null,
    tagline: "A fresh swag drop, every period",
    description:
      "A surprise box of limited swag delivered every period. Renews automatically in USDT, and you can cancel anytime.",
    subscription: { interval: "every 2 minutes (demo)" },
  },
];

export const shopProducts = products.filter((p) => !p.subscription);
export const builderBox = products.find((p) => p.subscription)!;

export function findProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}
