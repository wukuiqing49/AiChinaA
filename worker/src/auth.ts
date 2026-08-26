import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import type { Env, SessionUser } from "./types";

const fixedAccountSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9._-]{3,32}$/),
  displayName: z.string().min(1).max(64).nullable().optional(),
  salt: z.string().min(16),
  passwordHash: z.string().min(32),
  iterations: z.number().int().min(100_000).max(1_000_000),
});

type FixedAccount = z.infer<typeof fixedAccountSchema>;

export class AuthError extends Error {}

export async function verifyFixedCredentials(
  username: string,
  password: string,
  env: Env,
): Promise<SessionUser> {
  const account = readFixedAccounts(env).find((candidate) => candidate.username === username);
  if (!account || !(await passwordMatches(password, account))) {
    throw new AuthError("用户名或密码错误。");
  }
  return {
    id: `local:${account.username}`,
    username: account.username,
    displayName: account.displayName ?? null,
  };
}

export async function createSession(user: SessionUser, env: Env): Promise<string> {
  return new SignJWT({ username: user.username, displayName: user.displayName })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(sessionKey(env));
}

export async function verifySession(token: string, env: Env): Promise<SessionUser> {
  const verified = await jwtVerify(token, sessionKey(env));
  const username = typeof verified.payload.username === "string" ? verified.payload.username : null;
  if (!verified.payload.sub || !username) {
    throw new AuthError("Session is invalid.");
  }
  return {
    id: verified.payload.sub,
    username,
    displayName: typeof verified.payload.displayName === "string" ? verified.payload.displayName : null,
  };
}

function readFixedAccounts(env: Env): FixedAccount[] {
  if (!env.FIXED_ACCOUNTS || !env.SESSION_SECRET) {
    throw new AuthError("固定账户尚未配置。");
  }
  try {
    const parsed: unknown = JSON.parse(env.FIXED_ACCOUNTS);
    const accounts = Array.isArray(parsed) ? parsed : [parsed];
    return z.array(fixedAccountSchema).min(1).parse(accounts);
  } catch {
    throw new AuthError("固定账户配置无效。");
  }
}

async function passwordMatches(password: string, account: FixedAccount): Promise<boolean> {
  const derived = await derivePasswordHash(password, base64ToBytes(account.salt), account.iterations);
  return timingSafeEqual(derived, base64ToBytes(account.passwordHash));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function sessionKey(env: Env): Uint8Array {
  if (!env.SESSION_SECRET) {
    throw new AuthError("Session signing is not configured.");
  }
  return new TextEncoder().encode(env.SESSION_SECRET);
}
