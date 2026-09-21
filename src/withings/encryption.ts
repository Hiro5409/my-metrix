import { ConfigurationError } from "../configuration";

const ENCRYPTION_PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64FromBytes(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importAesKey(rawKey: string) {
  const keyBytes = bytesFromBase64(rawKey);
  if (keyBytes.byteLength !== KEY_BYTES) {
    throw new ConfigurationError("Token encryption key is not configured correctly.");
  }

  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
    "encrypt",
  ]);
}

export async function encryptTokenJson(value: string, rawKey: string) {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)),
  );

  return `${ENCRYPTION_PREFIX}${base64FromBytes(iv)}.${base64FromBytes(encrypted)}`;
}

export async function decryptTokenJson(value: string, rawKey: string) {
  if (!value.startsWith(ENCRYPTION_PREFIX)) return undefined;

  const [ivValue, encryptedValue] = value.slice(ENCRYPTION_PREFIX.length).split(".");
  if (!ivValue || !encryptedValue) return undefined;

  const key = await importAesKey(rawKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(ivValue) },
    key,
    bytesFromBase64(encryptedValue),
  );

  return new TextDecoder().decode(decrypted);
}
