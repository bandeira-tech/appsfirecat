#!/usr/bin/env -S deno run -A
/**
 * Test the service provider flow:
 *
 * 1. Provider has an account and hosts sites for users
 * 2. Provider writes links: mutable://accounts/{provider}/hosted/{userId} -> user's site
 * 3. Host target: mutable://accounts/{provider}/hosted/
 * 4. Request: GET /{userId}/index.html follows the link
 */

import "jsr:@std/dotenv/load";
import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";
import * as encrypt from "jsr:@bandeira-tech/b3nd-sdk/encrypt";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ||
  "https://testnet-evergreen.fire.cat";

async function signedWrite(
  client: HttpClient,
  uri: string,
  data: unknown,
  publicKeyHex: string,
  privateKeyHex: string,
): Promise<void> {
  const signedMessage = await encrypt.createAuthenticatedMessageWithHex(
    data,
    publicKeyHex,
    privateKeyHex,
  );
  const result = await client.write(uri, signedMessage);
  if (!result.success) {
    throw new Error(`Failed to write ${uri}: ${result.error}`);
  }
}

async function main() {
  console.log("=== Service Provider Flow Test ===\n");

  const client = new HttpClient({ url: BACKEND_URL });

  // Generate provider keypair
  console.log("Generating provider identity...");
  const provider = await encrypt.generateSigningKeyPair();
  console.log(`Provider pubkey: ${provider.publicKeyHex.substring(0, 16)}...`);

  // Generate user keypair
  console.log("Generating user identity...");
  const user = await encrypt.generateSigningKeyPair();
  console.log(`User pubkey: ${user.publicKeyHex.substring(0, 16)}...`);

  // User creates their site content
  console.log("\n--- User creates site content ---");
  const userSiteBase = `immutable://accounts/${user.publicKeyHex}/site`;

  await signedWrite(
    client,
    `${userSiteBase}/index.html`,
    `<!DOCTYPE html>
<html>
<head><title>User's Site</title></head>
<body>
  <h1>Welcome to ${user.publicKeyHex.substring(0, 8)}'s Site!</h1>
  <p>This content is hosted by the user but served through a provider.</p>
  <link rel="stylesheet" href="styles.css">
</body>
</html>`,
    user.publicKeyHex,
    user.privateKeyHex,
  );
  console.log(`  Created: ${userSiteBase}/index.html`);

  await signedWrite(
    client,
    `${userSiteBase}/styles.css`,
    `body { font-family: sans-serif; background: #1a1a2e; color: #eee; padding: 2rem; }
h1 { color: #e94560; }`,
    user.publicKeyHex,
    user.privateKeyHex,
  );
  console.log(`  Created: ${userSiteBase}/styles.css`);

  // Provider creates a link to user's site
  console.log("\n--- Provider creates hosting link ---");
  const providerHostedBase = `mutable://accounts/${provider.publicKeyHex}/hosted`;

  // The link: provider/hosted/{shortId} -> user's site
  const shortId = user.publicKeyHex.substring(0, 8);
  const linkUri = `${providerHostedBase}/${shortId}`;
  const linkTarget = `${userSiteBase}/`;

  await signedWrite(
    client,
    linkUri,
    linkTarget, // Just a string = implicit link
    provider.publicKeyHex,
    provider.privateKeyHex,
  );
  console.log(`  Created link: ${linkUri}`);
  console.log(`  Points to: ${linkTarget}`);

  // Print test info
  console.log("\n=== Test Setup Complete ===\n");

  console.log("To test, run the host with:\n");
  console.log(`  TARGET="${providerHostedBase}/" deno task start:public-static\n`);

  console.log("Then access:");
  console.log(`  http://localhost:8080/${shortId}/`);
  console.log(`  http://localhost:8080/${shortId}/index.html`);
  console.log(`  http://localhost:8080/${shortId}/styles.css`);

  console.log("\n--- Flow explanation ---");
  console.log(`1. Host target: ${providerHostedBase}/`);
  console.log(`2. GET /${shortId}/index.html`);
  console.log(`3. Host reads: ${providerHostedBase}/${shortId}/index.html (not found)`);
  console.log(`4. Walks up, finds link at: ${providerHostedBase}/${shortId}`);
  console.log(`5. Link value: "${linkTarget}"`);
  console.log(`6. Follows link to: ${userSiteBase}/index.html`);
  console.log(`7. Serves user's content!`);

  console.log("\n--- Environment vars to save ---");
  console.log(`PROVIDER_PUBKEY=${provider.publicKeyHex}`);
  console.log(`PROVIDER_PRIVATE_KEY=${provider.privateKeyHex}`);
  console.log(`USER_PUBKEY=${user.publicKeyHex}`);
  console.log(`USER_PRIVATE_KEY=${user.privateKeyHex}`);
}

main().catch(console.error);
