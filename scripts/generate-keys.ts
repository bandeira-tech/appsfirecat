#!/usr/bin/env -S deno run -A
/**
 * Generate Ed25519 keypair for B3nd authentication.
 *
 * Usage:
 *   deno run -A scripts/generate-keys.ts
 *   deno run -A scripts/generate-keys.ts --prefix HOST
 *   deno run -A scripts/generate-keys.ts --prefix SITE
 */

import * as encrypt from "jsr:@bandeira-tech/b3nd-sdk/encrypt";

const prefix = Deno.args.includes("--prefix")
  ? Deno.args[Deno.args.indexOf("--prefix") + 1] || ""
  : "";

const keypair = await encrypt.generateSigningKeyPair();

const pubkeyName = prefix ? `${prefix}_PUBKEY` : "PUBKEY";
const privateName = prefix ? `${prefix}_PRIVATE_KEY` : "PRIVATE_KEY";

console.log(`${pubkeyName}=${keypair.publicKeyHex}`);
console.log(`${privateName}=${keypair.privateKeyHex}`);
