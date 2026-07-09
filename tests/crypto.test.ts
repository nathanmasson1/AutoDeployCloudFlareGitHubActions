import { describe, expect, it } from "vitest";
import { decryptText, encryptText } from "../src/worker/lib/crypto";

describe("token encryption", () => {
  it("round-trips encrypted text without exposing plaintext", async () => {
    const secret = "test-secret-with-enough-length";
    const token = "cf_super_secret_token";
    const cipher = await encryptText(token, secret);

    expect(cipher).not.toContain(token);
    await expect(decryptText(cipher, secret)).resolves.toBe(token);
  });
});
