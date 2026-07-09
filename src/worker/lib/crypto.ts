import { base64UrlDecode, base64UrlEncode } from "../../shared/utils";

async function keyFromSecret(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  if (!secret || secret.length < 16) {
    throw new Error("TOKEN_ENCRYPTION_KEY precisa ter pelo menos 16 caracteres.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, usages);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptText(plainText: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plainText));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(cipher))}`;
}

export async function decryptText(cipherText: string, secret: string): Promise<string> {
  const [ivText, payloadText] = cipherText.split(".");
  if (!ivText || !payloadText) throw new Error("Token criptografado invalido.");
  const key = await keyFromSecret(secret, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivText) as BufferSource },
    key,
    toArrayBuffer(base64UrlDecode(payloadText)),
  );
  return new TextDecoder().decode(plain);
}
