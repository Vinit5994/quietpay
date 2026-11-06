# Swag Counter visual reference (ETHGlobal swag store style)

Observed on https://ethglobal.com/swag on 2026-11-06. The screenshots in this folder (`01-…05-*.jpg`) are **local only**: `.gitignore` keeps them out of git because they contain ETHGlobal's branding and photos.

Goal: Swag Counter should *feel* like ETHGlobal's swag store, using **our own name, logo, product photos and copy**. Don't copy ETHGlobal's logo, wordmark, illustrations, product photos or text.

## Overall feel
- Light, airy, lots of white space; content in a centered container about 1200px wide.
- **Soft pastel gradient wash** behind the header and hero: peach/cream at top-left fading to lavender and mint at top-right, then to white further down.
- Near-black text (`#0A0A0A` body, `#111827` headings) on white. Muted grey (`#6B7280`-ish) for secondary text.
- Playful accents: yellow **four-point sparkle stars** with a navy outline, small navy dots and rings scattered around the hero image, and a tilted ellipse "stage" (peach → indigo gradient with a dark navy rim) under the hero photo.

## Typography
- ETHGlobal uses **Roobert** (commercial; we can't use it). Free lookalikes on Google Fonts: **Plus Jakarta Sans** (closest feel) or **Hanken Grotesk**.
- Headings bold (700), tight letter-spacing; hero heading very large (≈ 56–64px), two lines; page title ≈ 36px; product names ≈ 18px semibold, centered under the card.
- Body 16px regular, generous line height.

## Components
| Component | What it looks like |
|---|---|
| **Top nav** | Logo + wordmark left, text links centered (Events, …, Swag, About), avatar circle right. No background bar; it sits on the gradient. A tiny green "New" superscript badge on one link. |
| **Hero** | Left: big two-line headline, one grey sentence, dark pill-ish button (`#2B2540`-ish dark navy/purple, white text, ~8px radius) "Browse collection". Right: person wearing the product on the gradient ellipse with sparkles. |
| **Featured banner** | Wide rounded card (≈24px radius) with a cream → lavender gradient and a dotted grid pattern at the right edge. A white product card overlaps its left edge. Right side: pink "● New Arrival" pill badge, bold product title, short description, outlined button. |
| **Section title** | "All Items": very large bold heading, left aligned. |
| **Product grid** | 3 columns (1 on phone), ~48px gap. Each card: square image on a **very pale cream** (`#FEFDEB`-ish) or white background, 1px light border, ~8px radius, product photo centered on a plain background. Name centered below in semibold dark text. No price on the grid card. |
| **Product page** | Breadcrumb ("Swag Store / Product"). Left: thumbnail strip (rounded bordered tiles, selected one has a darker border) above a large bordered image. Right: big bold title, price in large regular weight ("$555 USD"), green check "In stock and ready to ship", "Description" heading with a thin rule, two info tiles side by side (icon + "Delivers worldwide / Free shipping", icon + "Members discount / …"), "Select an option" with "Size guide" link right, **size buttons** as a grid of bordered rounded tiles (S, M, L, XL, 2XL, 3XL), and a "Ships within 5 business days" line with a truck icon. |

## Swag Counter mapping (task B5)
- Our name + our own simple logo mark (for example a sparkle inside a rounded square). Prices in **USDT** ("25.00 USDT"), shown on the product page and in the cart.
- Products: Builder Hoodie (S–XL), Ship-It Tee, Cap, Sticker Pack, and Builder Box (subscription) as the **featured banner** item with a "New" or "Monthly drop" pill.
- Product images: simple illustrated/flat SVG garments generated in code (our own artwork), on the pale cream card background.
- Primary button: dark navy/purple. On the product page the CTA is **"Add to cart"**; the cart CTA is **"Pay with USDT"** (redirects to QuietPay checkout).
- Info tiles adapted to us: "Pay in USDT · No gas fees", "Ships worldwide · Free at the venue counter".
