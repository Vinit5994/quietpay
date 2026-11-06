export type ArtKind = "hoodie" | "tee" | "cap" | "stickers" | "box";

export interface ProductPhoto {
  /** path under /public */
  src: string;
  alt: string;
  /** object-position for square crops, e.g. "50% 35%" */
  focus?: string;
}

export interface Product {
  id: string;
  name: string;
  /** USDT, 2 decimals */
  price: string;
  kind: ArtKind;
  /** main garment colour + accent for the illustration */
  colors: { base: string; accent: string };
  sizes: string[] | null;
  /** Real photos (first = main). Without photos the code-drawn art is shown. */
  photos?: ProductPhoto[];
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
    colors: { base: "#f3f4f6", accent: "#6d5dfc" },
    sizes: ["S", "M", "L", "XL", "2XL"],
    photos: [
      { src: "/products/hoodie-front.jpg", alt: "Person wearing the white Builder Hoodie, front view", focus: "50% 42%" },
      { src: "/products/hoodie-back.jpg", alt: "White Builder Hoodie seen from the back with the hood up", focus: "50% 38%" },
    ],
    tagline: "Heavyweight fleece for late-night shipping",
    description:
      "A heavyweight white fleece hoodie with a roomy hood and kangaroo pocket. Warm enough for an air-conditioned hacker hall at 4am.",
  },
  {
    id: "ship-it-tee",
    name: "Ship-It Tee",
    price: "12.00",
    kind: "tee",
    colors: { base: "#f4f1e8", accent: "#6d5dfc" },
    sizes: ["S", "M", "L", "XL", "2XL"],
    photos: [{ src: "/products/tee.jpg", alt: "Plain white Ship-It Tee laid flat on a grey background" }],
    tagline: "Soft cotton, everyday fit",
    description: "A soft, pre-shrunk cotton tee in clean white, so it survives the hotel laundry and goes under every hoodie.",
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
    photos: [{ src: "/products/box.jpg", alt: "Kraft cardboard Builder Box on a cream background" }],
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
