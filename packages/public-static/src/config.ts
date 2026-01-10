/**
 * Configuration for public-static host.
 */

import type { HostConfig } from "@appsfirecat/host-protocol";

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): HostConfig {
  const backendUrl = Deno.env.get("BACKEND_URL");
  if (!backendUrl) {
    throw new Error("BACKEND_URL environment variable is required");
  }

  const hostPrivateKey = Deno.env.get("HOST_PRIVATE_KEY");
  if (!hostPrivateKey) {
    throw new Error("HOST_PRIVATE_KEY environment variable is required");
  }

  const hostPubkey = Deno.env.get("HOST_PUBKEY");
  if (!hostPubkey) {
    throw new Error("HOST_PUBKEY environment variable is required");
  }

  const port = parseInt(Deno.env.get("PORT") ?? "8080", 10);

  const allowedApps = Deno.env.get("ALLOWED_APPS")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const targetCacheTtl = parseInt(
    Deno.env.get("TARGET_CACHE_TTL") ?? "5000",
    10,
  );

  const manifestCacheTtl = parseInt(
    Deno.env.get("MANIFEST_CACHE_TTL") ?? "60000",
    10,
  );

  return {
    backendUrl,
    hostPrivateKey,
    hostPubkey,
    port,
    allowedApps,
    targetCacheTtl,
    manifestCacheTtl,
  };
}

/**
 * Create a default config for development.
 * Generates a random keypair if not provided.
 * Uses "open" URI pattern for testing without auth.
 */
export async function loadDevConfig(): Promise<HostConfig> {
  const backendUrl = Deno.env.get("BACKEND_URL") ?? "https://testnet-evergreen.fire.cat";
  const port = parseInt(Deno.env.get("PORT") ?? "8080", 10);

  let hostPrivateKey = Deno.env.get("HOST_PRIVATE_KEY");
  let hostPubkey = Deno.env.get("HOST_PUBKEY");

  if (!hostPrivateKey || !hostPubkey) {
    console.log("No host keys provided, generating random keypair for dev...");
    const keypair = await generateDevKeypair();
    hostPrivateKey = keypair.privateKey;
    hostPubkey = keypair.publicKey;
    console.log(`Generated dev host pubkey: ${hostPubkey}`);
  }

  return {
    backendUrl,
    hostPrivateKey,
    hostPubkey,
    port,
    targetCacheTtl: 5000,
    manifestCacheTtl: 60000,
    uriPattern: "accounts", // Use accounts protocol with signed writes
  };
}

/**
 * Generate a random X25519 keypair for development.
 * For dev purposes, we just generate random 32-byte keys.
 * In production, use proper key generation.
 */
async function generateDevKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  // For dev/testing, generate random bytes
  // Real X25519 would clamp the private key, but for dev this is fine
  const privateKeyBytes = new Uint8Array(32);
  const publicKeyBytes = new Uint8Array(32);
  crypto.getRandomValues(privateKeyBytes);
  crypto.getRandomValues(publicKeyBytes);

  return {
    privateKey: bufferToHex(privateKeyBytes),
    publicKey: bufferToHex(publicKeyBytes),
  };
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
