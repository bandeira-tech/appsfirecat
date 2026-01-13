#!/usr/bin/env -S deno run -A
/**
 * Deploy static files to B3nd.
 *
 * Usage:
 *   deno run -A scripts/deploy-site.ts
 *   deno run -A scripts/deploy-site.ts [source-dir]
 *
 * Environment (via .env file or env vars):
 *   BACKEND_URL    - B3nd backend URL (default: https://testnet-evergreen.fire.cat)
 *   SITE_PUBKEY    - Ed25519 public key (hex)
 *   SITE_PRIVATE_KEY - Ed25519 private key (hex)
 *   DEPLOY_TARGET  - Target URI (default: immutable://accounts/{pubkey}/site)
 *                    Use {pubkey} as placeholder for the signing key
 *
 * If keys are not provided, generates new ones and prints them.
 */

import "jsr:@std/dotenv/load";
import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";
import * as encrypt from "jsr:@bandeira-tech/b3nd-sdk/encrypt";
import * as path from "jsr:@std/path";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ||
  "https://testnet-evergreen.fire.cat";
const DEFAULT_TARGET = "immutable://accounts/{pubkey}/site";

/**
 * Get content type from file extension.
 */
function getContentType(filename: string): string {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json; charset=utf-8";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".woff2")) return "font/woff2";
  if (filename.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

/**
 * Read all files from a directory (non-recursive).
 */
async function readSiteFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile) {
      const filePath = path.join(dir, entry.name);
      const content = await Deno.readTextFile(filePath);
      files.set(entry.name, content);
    }
  }

  return files;
}

/**
 * Sign and write data to B3nd.
 * Returns true if written successfully, false if already exists.
 */
async function signedWrite(
  client: HttpClient,
  uri: string,
  data: unknown,
  publicKeyHex: string,
  privateKeyHex: string,
): Promise<boolean> {
  const signedMessage = await encrypt.createAuthenticatedMessageWithHex(
    data,
    publicKeyHex,
    privateKeyHex,
  );

  const result = await client.write(uri, signedMessage);
  if (!result.success) {
    // Check if the error is because the immutable object already exists
    if (result.error?.includes("immutable object exists")) {
      return false; // Already exists
    }
    throw new Error(`Failed to write ${uri}: ${result.error}`);
  }
  return true;
}

async function main() {
  console.log("=== B3nd Static Site Deployer ===\n");

  // Get source directory from args or default to "site"
  const sourceDir = Deno.args[0] || path.join(Deno.cwd(), "site");

  // Get or generate keypair
  let publicKeyHex = Deno.env.get("SITE_PUBKEY");
  let privateKeyHex = Deno.env.get("SITE_PRIVATE_KEY");

  if (!publicKeyHex || !privateKeyHex) {
    console.log("No keys provided, generating new keypair...\n");
    const keypair = await encrypt.generateSigningKeyPair();
    publicKeyHex = keypair.publicKeyHex;
    privateKeyHex = keypair.privateKeyHex;

    console.log("Generated new identity:");
    console.log(`  SITE_PUBKEY=${publicKeyHex}`);
    console.log(`  SITE_PRIVATE_KEY=${privateKeyHex}`);
    console.log("\nSave these to reuse the same identity!\n");
  }

  // Get target, replace {pubkey} placeholder
  const targetTemplate = Deno.env.get("DEPLOY_TARGET") || DEFAULT_TARGET;
  const target = targetTemplate.replace(/\{pubkey\}/g, publicKeyHex);

  console.log(`Source:  ${sourceDir}`);
  console.log(`Target:  ${target}`);
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Pubkey:  ${publicKeyHex.substring(0, 16)}...\n`);

  // Create B3nd client
  const client = new HttpClient({ url: BACKEND_URL });

  // Read site files
  console.log("Reading files...");
  const files = await readSiteFiles(sourceDir);
  console.log(
    `Found ${files.size} files: ${Array.from(files.keys()).join(", ")}\n`,
  );

  if (files.size === 0) {
    console.error(`No files found in ${sourceDir}!`);
    Deno.exit(1);
  }

  // Normalize target (ensure no trailing slash for building URIs)
  const targetBase = target.endsWith("/") ? target.slice(0, -1) : target;

  // Upload each file
  console.log("Uploading files...");

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const [filename, content] of files) {
    const uri = `${targetBase}/${filename}`;
    const wasWritten = await signedWrite(
      client,
      uri,
      content,
      publicKeyHex,
      privateKeyHex,
    );

    if (wasWritten) {
      console.log(`  ${filename} -> uploaded`);
      uploadedCount++;
    } else {
      console.log(`  ${filename} -> already exists (skipped)`);
      skippedCount++;
    }
  }

  if (skippedCount > 0) {
    console.log(
      `\n${uploadedCount} files uploaded, ${skippedCount} already existed.`,
    );
  }

  // Print access info
  console.log("\n=== Deployment Complete ===\n");

  console.log("To serve this content:\n");
  console.log(`  TARGET="${targetBase}/" deno task start:public-static\n`);

  console.log("Or via API:");
  console.log(`  GET /api/v1/serve/index.html`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  Deno.exit(1);
});
