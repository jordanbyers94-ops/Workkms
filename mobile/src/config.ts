// Your Railway app's public address (the Cloudflare domain once DNS is set up),
// e.g. https://kms.ausairelectrical.com.au. Set it in .env.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
