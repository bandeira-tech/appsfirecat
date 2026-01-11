/**
 * public-static host
 *
 * A minimal static file server that reads from B3nd and serves HTTP.
 * Decrypts content using the host's private key when content is encrypted.
 *
 * Usage:
 *   # With .env file (recommended)
 *   deno run -A mod.ts
 *
 *   # Or with environment variables
 *   BACKEND_URL=https://testnet-evergreen.fire.cat \
 *   TARGET=mutable://accounts/{pubkey}/target \
 *   PORT=8080 \
 *   deno run -A mod.ts
 *
 * For development (generates random keypair):
 *   deno run -A mod.ts --dev
 */

import "jsr:@std/dotenv/load";
import { loadConfig, loadDevConfig } from "./src/config.ts";
import { startServer } from "./src/server.ts";

// Check for dev mode
const isDev = Deno.args.includes("--dev");

// Load config
const config = isDev ? await loadDevConfig() : loadConfig();

// Start server
startServer(config);
