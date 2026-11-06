export const env = {
  apiUrl: process.env.NEXT_PUBLIC_QUIETPAY_API_URL ?? "http://localhost:4010",
  walletMode: (process.env.NEXT_PUBLIC_WALLET_MODE ?? "dev") as "dev" | "privy",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
};
