import { z } from "zod";
import { HttpError } from "./http";

const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unbase64url = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const fingerprint = async (value: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const keyringSchema = z.strictObject({ active: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), keys: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), z.string().regex(/^[A-Za-z0-9_-]{43}$/)) });
function keyring(raw: string | undefined) {
  try {
    const ring = keyringSchema.parse(JSON.parse(raw ?? ""));
    if (!Object.hasOwn(ring.keys, ring.active) || Object.keys(ring.keys).length > 10) throw new Error();
    for (const key of Object.values(ring.keys)) if (unbase64url(key).length !== 32 || base64url(unbase64url(key)) !== key) throw new Error();
    return ring;
  } catch { throw new HttpError(503, "encryption_unavailable", "Connect encryption is not configured correctly."); }
}
async function deriveKey(value: string, context: string) {
  const source = await crypto.subtle.importKey("raw", unbase64url(value), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("steed.connect.v1"), info: encoder.encode(context) }, source,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function seal(raw: string | undefined, context: string, plaintext: string): Promise<string> {
  const ring = keyring(raw);
  const value = ring.keys[ring.active];
  if (!value) throw new HttpError(503, "encryption_unavailable", "The active encryption key is unavailable.");
  const key = await deriveKey(value, context);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) }, key, encoder.encode(plaintext));
  return ["1", ring.active, base64url(nonce), base64url(new Uint8Array(data))].join(".");
}
export async function unseal(raw: string | undefined, context: string, ciphertext: string): Promise<string> {
  const ring = keyring(raw);
  try {
    const [version, id, nonce, data, extra] = ciphertext.split(".");
    if (version !== "1" || !id || !nonce || !data || extra || !Object.hasOwn(ring.keys, id)) throw new Error();
    const value = ring.keys[id];
    if (!value || unbase64url(nonce).length !== 12) throw new Error();
    const key = await deriveKey(value, context);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(nonce), additionalData: encoder.encode(context) }, key, unbase64url(data)));
  } catch { throw new HttpError(503, "decryption_failed", "The key cannot be recovered. Restore its encryption key version or revoke and reissue the token."); }
}
