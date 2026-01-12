#!/usr/bin/env -S deno run -A
/**
 * Deploy the documentation site to B3nd.
 *
 * Usage:
 *   deno run -A scripts/deploy-site.ts
 *
 * Environment (via .env file or env vars):
 *   BACKEND_URL - B3nd backend URL (default: https://testnet-evergreen.fire.cat)
 *   SITE_PRIVATE_KEY - Site's Ed25519 private key (hex)
 *   SITE_PUBKEY - Site's Ed25519 public key (hex)
 *
 * If keys are not provided, generates new ones and prints them.
 *
 * After deploying, set TARGET to serve from this site:
 *   TARGET=immutable://accounts/{pubkey}/site/ deno task start:public-static
 */

import "jsr:@std/dotenv/load";
import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";
import * as encrypt from "jsr:@bandeira-tech/b3nd-sdk/encrypt";
import * as path from "jsr:@std/path";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ||
  "https://testnet-evergreen.fire.cat";
const SITE_DIR = path.join(Deno.cwd(), "site");

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
 * Read all files from the site directory.
 */
async function readSiteFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  for await (const entry of Deno.readDir(SITE_DIR)) {
    if (entry.isFile) {
      const filePath = path.join(SITE_DIR, entry.name);
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
  console.log("=== Apps Firecat Site Deployer ===\n");

  // Get or generate keypair
  let publicKeyHex = Deno.env.get("SITE_PUBKEY");
  let privateKeyHex = Deno.env.get("SITE_PRIVATE_KEY");

  if (!publicKeyHex || !privateKeyHex) {
    console.log("No site keys provided, generating new keypair...\n");
    const keypair = await encrypt.generateSigningKeyPair();
    publicKeyHex = keypair.publicKeyHex;
    privateKeyHex = keypair.privateKeyHex;

    console.log("Generated new site identity:");
    console.log(`  SITE_PUBKEY=${publicKeyHex}`);
    console.log(`  SITE_PRIVATE_KEY=${privateKeyHex}`);
    console.log("\nSave these to reuse the same identity!\n");
  }

  console.log(`Site pubkey: ${publicKeyHex.substring(0, 16)}...`);
  console.log(`Backend: ${BACKEND_URL}\n`);

  // Create B3nd client
  const client = new HttpClient({ url: BACKEND_URL });

  // Read site files
  console.log("Reading site files...");
  const files = await readSiteFiles();
  console.log(
    `Found ${files.size} files: ${Array.from(files.keys()).join(", ")}\n`,
  );

  if (files.size === 0) {
    console.error("No files found in site/ directory!");
    Deno.exit(1);
  }

  // Upload to a simple path: immutable://accounts/{pubkey}/site/
  const siteBase = `immutable://accounts/${publicKeyHex}/site`;

  // Upload each file
  console.log("Uploading files...");

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const [filename, content] of files) {
    const uri = `${siteBase}/${filename}`;
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

  // Update the mutable target pointer (just a string pointing to the site)
  console.log("\nUpdating target pointer...");
  const targetUri = `mutable://accounts/${publicKeyHex}/target`;
  const targetValue = `${siteBase}/`; // Just a string!

  await signedWrite(client, targetUri, targetValue, publicKeyHex, privateKeyHex);
  console.log(`  target -> "${targetValue}"`);

  // Print access info
  console.log("\n=== Deployment Complete ===\n");

  console.log("To serve this site, run:\n");
  console.log(`  TARGET="${siteBase}/" deno task start:public-static\n`);

  console.log("Or use the mutable pointer (auto-resolves):\n");
  console.log(`  TARGET="${targetUri}" deno task start:public-static\n`);

  console.log("Then access:");
  console.log("  http://localhost:8080/");
  console.log("  http://localhost:8080/index.html");
  console.log("  http://localhost:8080/styles.css");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  Deno.exit(1);
});
