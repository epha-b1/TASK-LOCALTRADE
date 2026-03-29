import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { decryptText, encryptText } from "../src/security/encryption.js";

describe("security primitives", () => {
  test("sensitive-field encryption implementation is AES-256-GCM", () => {
    const source = readFileSync(new URL("../src/security/encryption.ts", import.meta.url), "utf8");
    expect(source).toContain("aes-256-gcm");
  });

  test("encrypted payload includes IV+tag and rejects tampering", () => {
    const plaintext = "123456789";
    const encoded = encryptText(plaintext);
    const raw = Buffer.from(encoded, "base64url");

    // Expected envelope shape for AES-GCM in implementation: 12-byte IV + 16-byte tag + ciphertext
    expect(raw.length).toBeGreaterThan(28);

    const roundtrip = decryptText(encoded);
    expect(roundtrip).toBe(plaintext);

    const tampered = Buffer.from(raw);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
    expect(() => decryptText(tampered.toString("base64url"))).toThrow();
  });
});
