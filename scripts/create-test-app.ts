#!/usr/bin/env -S deno run -A
/**
 * Create a test app in B3nd for testing the public-static server.
 *
 * Usage:
 *   deno run -A scripts/create-test-app.ts [--backend URL]
 *
 * This creates:
 *   - A test app with a real Ed25519 keypair
 *   - A simple HTML/CSS/JS build in immutable://accounts/{appPubkey}
 *   - Signed writes using the app's private key
 *   - A manifest
 */

import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";
import * as encrypt from "jsr:@bandeira-tech/b3nd-sdk/encrypt";

const BACKEND_URL = Deno.args.find(a => a.startsWith("--backend="))?.split("=")[1]
  ?? Deno.env.get("BACKEND_URL")
  ?? "https://testnet-evergreen.fire.cat";

console.log(`Using backend: ${BACKEND_URL}`);

const client = new HttpClient({ url: BACKEND_URL });

// Generate a build hash
function generateBuildHash(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Test content
const testHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test App - Apps Firecat</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <h1>Apps Firecat Test Page</h1>
    <p>If you can see this, the public-static server is working!</p>
    <div class="info">
      <h2>Request Info</h2>
      <pre id="info">Loading...</pre>
    </div>
    <div class="links">
      <h2>Test Links</h2>
      <ul>
        <li><a href="./">Home (index.html)</a></li>
        <li><a href="about.html">About page</a></li>
        <li><a href="nonexistent">SPA fallback test</a></li>
        <li><a href="api/data.json">JSON data</a></li>
      </ul>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`;

const testCss = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  padding: 2rem;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: 0 10px 40px rgba(0,0,0,0.2);
}

h1 {
  color: #333;
  margin-bottom: 1rem;
}

h2 {
  color: #666;
  font-size: 1.2rem;
  margin: 1.5rem 0 0.5rem;
}

p {
  color: #555;
  line-height: 1.6;
}

.info {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 0.5rem;
  margin-top: 1rem;
}

pre {
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.85rem;
  overflow-x: auto;
}

.links ul {
  list-style: none;
  padding-left: 1rem;
}

.links li {
  margin: 0.5rem 0;
}

.links a {
  color: #667eea;
  text-decoration: none;
}

.links a:hover {
  text-decoration: underline;
}`;

const testJs = `document.addEventListener('DOMContentLoaded', () => {
  const info = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    pathname: window.location.pathname,
    userAgent: navigator.userAgent.substring(0, 50) + '...',
  };
  document.getElementById('info').textContent = JSON.stringify(info, null, 2);
});`;

const aboutHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - Apps Firecat</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <h1>About This Test</h1>
    <p>This is a secondary page to test multi-page serving.</p>
    <p><a href="./">Back to home</a></p>
  </div>
</body>
</html>`;

const dataJson = JSON.stringify({
  message: "Hello from B3nd!",
  timestamp: Date.now(),
  source: "apps-firecat-test",
}, null, 2);

/**
 * Write signed data to B3nd accounts protocol.
 */
async function signedWrite(
  uri: string,
  data: unknown,
  publicKeyHex: string,
  privateKeyHex: string,
): Promise<{ success: boolean; error?: string }> {
  const signedMessage = await encrypt.createAuthenticatedMessageWithHex(
    data,
    publicKeyHex,
    privateKeyHex,
  );
  return await client.write(uri, signedMessage);
}

async function main() {
  console.log("\nGenerating app keypair...");

  // Generate a real Ed25519 keypair for the app
  const appKeypair = await encrypt.generateSigningKeyPair();
  const appPubkey = appKeypair.publicKeyHex;
  const appPrivateKey = appKeypair.privateKeyHex;

  const buildHash = generateBuildHash();
  const version = "1.0.0";

  console.log(`\nCreating test app:`);
  console.log(`  appPubkey:    ${appPubkey}`);
  console.log(`  buildHash:    ${buildHash}`);
  console.log(`  version:      ${version}\n`);

  // Use immutable://accounts/{appPubkey} for builds
  const baseUri = `immutable://accounts/${appPubkey}/builds/${buildHash}`;

  // Files to write
  const files: Record<string, { content: string; contentType: string }> = {
    "index.html": { content: testHtml, contentType: "text/html; charset=utf-8" },
    "styles.css": { content: testCss, contentType: "text/css; charset=utf-8" },
    "app.js": { content: testJs, contentType: "application/javascript; charset=utf-8" },
    "about.html": { content: aboutHtml, contentType: "text/html; charset=utf-8" },
    "api/data.json": { content: dataJson, contentType: "application/json; charset=utf-8" },
  };

  // Write each file with signature
  const fileEntries: Record<string, { size: number; contentType: string; encrypted: boolean }> = {};

  for (const [path, file] of Object.entries(files)) {
    const uri = `${baseUri}/${path}`;
    console.log(`Writing: ${uri}`);

    const result = await signedWrite(uri, file.content, appPubkey, appPrivateKey);
    if (!result.success) {
      console.error(`  Failed: ${result.error}`);
      continue;
    }

    fileEntries[path] = {
      size: new TextEncoder().encode(file.content).length,
      contentType: file.contentType,
      encrypted: false,
    };
    console.log(`  OK (${fileEntries[path].size} bytes)`);
  }

  // Create manifest
  const manifest = {
    manifestVersion: "1",
    buildHash,
    version,
    createdAt: Date.now(),
    files: fileEntries,
    routing: {
      spa: true,
      entrypoint: "index.html",
    },
    encryption: {
      enabled: false,
    },
  };

  const manifestUri = `${baseUri}/manifest.json`;
  console.log(`\nWriting manifest: ${manifestUri}`);
  const manifestResult = await signedWrite(manifestUri, manifest, appPubkey, appPrivateKey);
  if (!manifestResult.success) {
    console.error(`  Failed: ${manifestResult.error}`);
    Deno.exit(1);
  }
  console.log(`  OK`);

  // Write target pointer (mutable)
  const targetUri = `mutable://accounts/${appPubkey}/target`;
  const target = {
    buildHash,
    version,
    updatedAt: Date.now(),
  };

  console.log(`\nWriting target: ${targetUri}`);
  const targetResult = await signedWrite(targetUri, target, appPubkey, appPrivateKey);
  if (!targetResult.success) {
    console.error(`  Failed: ${targetResult.error}`);
    Deno.exit(1);
  }
  console.log(`  OK`);

  // Done!
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                      TEST APP CREATED                             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  App Pubkey: ${appPubkey.substring(0, 20)}...                     ║
║  Build Hash: ${buildHash}                                 ║
║  Version:    ${version}                                            ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  To test, start the server:                                       ║
║                                                                   ║
║    deno run -A packages/public-static/mod.ts --dev                ║
║                                                                   ║
║  Then visit:                                                      ║
║                                                                   ║
║    http://localhost:8080/${appPubkey.substring(0, 16)}.../ ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝

Full test URLs:
  http://localhost:8080/${appPubkey}/
  http://localhost:8080/${appPubkey}/about.html
  http://localhost:8080/${appPubkey}/api/data.json
  http://localhost:8080/${appPubkey}/nonexistent (SPA fallback)
`);

  // Save app info for later use
  const appInfo = {
    appPubkey,
    appPrivateKey, // Save for future updates
    buildHash,
    version,
    baseUri,
    targetUri,
  };
  await Deno.writeTextFile(".test-app.json", JSON.stringify(appInfo, null, 2));
  console.log(`App info saved to .test-app.json`);
}

main().catch(console.error);
