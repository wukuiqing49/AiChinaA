import { describe, expect, it } from "vitest";

import { AuthError, createSession, verifyFixedCredentials, verifySession } from "../src/auth";
import type { Env } from "../src/types";

const env: Env = {
  DB: {} as D1Database,
  FIXED_ACCOUNTS: JSON.stringify([
    {
      username: "tester",
      displayName: "Test User",
      salt: "H+loNWk+DUayhXSoRU0y5w==",
      passwordHash: "MNXNXwBMA43kmWv3NM3kE6XmPP/Va1LFq9DnRSTQkfI=",
      iterations: 100000,
    },
  ]),
  SESSION_SECRET: "test-session-secret-not-for-production",
  PUBLISH_SECRET: "test-publish-secret",
};

describe("fixed account authentication", () => {
  it("verifies a PBKDF2 password and round-trips the session", async () => {
    const user = await verifyFixedCredentials("tester", "correct-horse-battery-staple", env);
    expect(user).toEqual({ id: "local:tester", username: "tester", displayName: "Test User" });

    const token = await createSession(user, env);
    await expect(verifySession(token, env)).resolves.toEqual(user);
  });

  it("rejects an invalid password", async () => {
    await expect(verifyFixedCredentials("tester", "incorrect-password", env)).rejects.toBeInstanceOf(AuthError);
  });

  it("accepts a single account object for simple deployments", async () => {
    const account = JSON.parse(env.FIXED_ACCOUNTS)[0];
    const singleAccountEnv = { ...env, FIXED_ACCOUNTS: JSON.stringify(account) };
    await expect(verifyFixedCredentials("tester", "correct-horse-battery-staple", singleAccountEnv)).resolves.toMatchObject({
      username: "tester",
    });
  });
});
