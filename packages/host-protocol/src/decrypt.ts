/**
 * Decryption Utilities
 *
 * Handles unwrapping content keys and decrypting file content.
 * Uses X25519 for key exchange and AES-256-GCM for symmetric encryption.
 */

import type { DecryptContext, EncryptionConfig, Manifest } from "./types.ts";

/**
 * Check if a manifest indicates encrypted content.
 */
export function isEncrypted(manifest: Manifest): boolean {
  return manifest.encryption?.enabled === true;
}

/**
 * Get the wrapped content key for a specific host from the manifest.
 */
export function getWrappedKey(
  encryption: EncryptionConfig,
  hostPubkey: string,
): string | null {
  // Check multi-host keys first
  if (encryption.keys?.[hostPubkey]) {
    return encryption.keys[hostPubkey];
  }

  // Fall back to single wrapped key if host matches
  if (encryption.wrappedKey && encryption.hostPubkey === hostPubkey) {
    return encryption.wrappedKey;
  }

  // Legacy: single wrapped key without host specification
  if (encryption.wrappedKey && !encryption.hostPubkey) {
    return encryption.wrappedKey;
  }

  return null;
}

/**
 * Unwrap the content key using the host's private key.
 *
 * The wrapped key is the content key encrypted to the host's X25519 public key.
 * We decrypt it using our private key to get the symmetric content key.
 */
export async function unwrapContentKey(
  wrappedKeyHex: string,
  hostPrivateKeyHex: string,
): Promise<CryptoKey> {
  // Import the host's private key
  const privateKeyBytes = hexToBytes(hostPrivateKeyHex);

  // The wrapped key format: ephemeral_pubkey (32 bytes) + nonce (12 bytes) + ciphertext
  const wrappedBytes = hexToBytes(wrappedKeyHex);

  if (wrappedBytes.length < 44) {
    throw new DecryptError("Invalid wrapped key format", "INVALID_KEY");
  }

  const ephemeralPubkey = wrappedBytes.slice(0, 32);
  const nonce = wrappedBytes.slice(32, 44);
  const ciphertext = wrappedBytes.slice(44);

  // Derive shared secret using X25519
  const sharedSecret = await x25519(privateKeyBytes, ephemeralPubkey);

  // Derive AES key from shared secret
  const aesKey = await deriveAesKey(sharedSecret);

  // Decrypt the content key
  const contentKeyBytes = await decryptAesGcm(ciphertext, aesKey, nonce);

  // Import as AES-GCM key
  return await crypto.subtle.importKey(
    "raw",
    contentKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

/**
 * Decrypt file content using the content key.
 *
 * File format: nonce (12 bytes) + ciphertext
 */
export async function decryptContent(
  encrypted: Uint8Array,
  contentKey: CryptoKey,
): Promise<Uint8Array> {
  if (encrypted.length < 12) {
    throw new DecryptError("Invalid encrypted content format", "INVALID_CONTENT");
  }

  const nonce = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      contentKey,
      ciphertext,
    );
    return new Uint8Array(decrypted);
  } catch (_e) {
    throw new DecryptError("Decryption failed", "DECRYPT_FAILED");
  }
}

/**
 * Full decryption flow: unwrap key + decrypt content.
 */
export async function decrypt(
  encrypted: Uint8Array,
  context: DecryptContext,
): Promise<Uint8Array> {
  if (!context.manifest.encryption?.enabled) {
    // Not encrypted, return as-is
    return encrypted;
  }

  const wrappedKey = getWrappedKey(context.manifest.encryption, context.hostPubkey);
  if (!wrappedKey) {
    throw new DecryptError(
      "No wrapped key found for this host",
      "NO_KEY_FOR_HOST",
    );
  }

  const contentKey = await unwrapContentKey(wrappedKey, context.hostPrivateKey);
  return await decryptContent(encrypted, contentKey);
}

// =============================================================================
// Crypto Primitives (these would typically come from a crypto library)
// =============================================================================

/**
 * X25519 key exchange.
 * In production, use a proper library like @noble/curves.
 */
async function x25519(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  // Import keys for ECDH
  const privateKeyObj = await crypto.subtle.importKey(
    "raw",
    privateKey,
    { name: "X25519" },
    false,
    ["deriveBits"],
  );

  const publicKeyObj = await crypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "X25519" },
    false,
    [],
  );

  // Derive shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKeyObj },
    privateKeyObj,
    256,
  );

  return new Uint8Array(sharedBits);
}

/**
 * Derive an AES-256-GCM key from a shared secret using HKDF.
 */
async function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // Could use a fixed salt for the protocol
      info: new TextEncoder().encode("appsfirecat-content-key"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

/**
 * Decrypt with AES-256-GCM.
 */
async function decryptAesGcm(
  ciphertext: Uint8Array,
  key: CryptoKey,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert hex string to Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Error during decryption.
 */
export class DecryptError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_KEY"
      | "INVALID_CONTENT"
      | "DECRYPT_FAILED"
      | "NO_KEY_FOR_HOST",
  ) {
    super(message);
    this.name = "DecryptError";
  }
}
