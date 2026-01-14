/**
 * Configuration for public-static host.
 */

import type { HostConfig } from "../../host-protocol/mod.ts";

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

  const target = Deno.env.get("TARGET");
  if (!target) {
    throw new Error("TARGET environment variable is required");
  }

  const port = parseInt(Deno.env.get("PORT") ?? "8080", 10);
  const primaryDomain = Deno.env.get("PRIMARY_DOMAIN");

  return {
    backendUrl,
    hostPrivateKey,
    hostPubkey,
    target,
    port,
    primaryDomain,
  };
}

/**
 * Create a default config for development.
 * Generates a random keypair if not provided.
 */
export async function loadDevConfig(): Promise<HostConfig> {
  const backendUrl = Deno.env.get("BACKEND_URL") ??
    "https://testnet-evergreen.fire.cat";
  const port = parseInt(Deno.env.get("PORT") ?? "8080", 10);
  const target = Deno.env.get("TARGET"); // Optional in dev mode
  const primaryDomain = Deno.env.get("PRIMARY_DOMAIN");

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
    target,
    port,
    primaryDomain,
  };
}

/**
 * Generate a random X25519 keypair for development.
 */
async function generateDevKeypair(): Promise<
  { privateKey: string; publicKey: string }
> {
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
