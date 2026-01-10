/**
 * public-static host
 *
 * A minimal static file server that reads from B3nd and serves HTTP.
 * Decrypts content using the host's private key when content is encrypted.
 *
 * Usage:
 *   BACKEND_URL=https://testnet-evergreen.fire.cat \
 *   HOST_PRIVATE_KEY=... \
 *   HOST_PUBKEY=... \
 *   PORT=8080 \
 *   deno run -A mod.ts
 *
 * Or for development (generates random keypair):
 *   deno run -A mod.ts --dev
 */

import { loadConfig, loadDevConfig } from "./src/config.ts";
import { startServer } from "./src/server.ts";

// Check for dev mode
const isDev = Deno.args.includes("--dev");

// Load config
const config = isDev ? await loadDevConfig() : loadConfig();

// Start server
startServer(config);
