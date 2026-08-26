import { pbkdf2Sync, randomBytes } from "node:crypto";

const username = process.env.AUTH_USERNAME;
const password = process.env.AUTH_PASSWORD;
const displayName = process.env.AUTH_DISPLAY_NAME || null;

if (!username || !/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
  throw new Error("AUTH_USERNAME must contain 3-32 letters, numbers, dots, underscores, or hyphens.");
}
if (!password || password.length < 8) {
  throw new Error("AUTH_PASSWORD must contain at least 8 characters.");
}

// Cloudflare Workers WebCrypto supports PBKDF2 iteration counts up to 100,000.
const iterations = 100_000;
const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
console.log(JSON.stringify({
  username,
  displayName,
  salt: salt.toString("base64"),
  passwordHash: passwordHash.toString("base64"),
  iterations,
}));
