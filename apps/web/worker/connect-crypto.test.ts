import { describe, expect, it } from "vitest";
import { base64url, fingerprint, randomSecret, seal, unseal } from "./connect-crypto";
const ring = (id = "one") => JSON.stringify({ active: id, keys: { [id]: randomSecret() } });
describe("Connect recoverable encryption", () => {
  it("authenticates record context, randomizes nonces and keeps old key versions usable", async () => {
    const keys = ring(); const value = `steedc_${randomSecret()}`;
    const first = await seal(keys, "record-one", value); const second = await seal(keys, "record-one", value);
    expect(first).not.toBe(second); expect(first).not.toContain(value);
    expect(await unseal(keys, "record-one", first)).toBe(value);
    await expect(unseal(keys, "record-two", first)).rejects.toMatchObject({ code: "decryption_failed" });
    const old = JSON.parse(keys) as { keys: Record<string, string> };
    const rotated = JSON.stringify({ active: "two", keys: { ...old.keys, two: randomSecret() } });
    expect(await unseal(rotated, "record-one", first)).toBe(value);
    expect(await seal(rotated, "record-one", value)).toMatch(/^1\.two\./);
    await expect(unseal(ring("two"), "record-one", first)).rejects.toMatchObject({ status: 503 });
    expect(await fingerprint("first")).not.toBe(await fingerprint("second"));
  });
  it.each([undefined, "bad", "{}", JSON.stringify({ active: "missing", keys: {} }), JSON.stringify({ active: "bad", keys: { bad: "not-a-key" } }), JSON.stringify({ active: "bad", keys: { bad: "_".repeat(43) } })])("fails closed for invalid keyrings", async (value) => {
    await expect(seal(value, "context", "secret")).rejects.toMatchObject({ code: "encryption_unavailable" });
  });
  it("rejects malformed and tampered ciphertext", async () => {
    const keys = ring(); const value = await seal(keys, "context", "secret");
    for (const ciphertext of ["bad", `${value}.extra`, value.replace(/^1\./, "2."), `1.one.${base64url(new Uint8Array(8))}.abcd`, value.slice(0, -4) + "abcd"]) {
      await expect(unseal(keys, "context", ciphertext)).rejects.toMatchObject({ code: "decryption_failed" });
    }
  });
});
