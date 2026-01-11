/**
 * HTTP Server for public-static host.
 *
 * Uses Hono for routing and the native Deno HTTP server.
 */

import { Hono } from "jsr:@hono/hono@^4";
import { cors } from "jsr:@hono/hono@^4/cors";
import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";
import type { HostConfig } from "../../host-protocol/mod.ts";
import { createHandler } from "./handler.ts";

/**
 * Create and configure the HTTP server.
 */
export function createServer(config: HostConfig) {
  // Create B3nd client
  const b3ndClient = new HttpClient({ url: config.backendUrl });

  // Create request handler
  const handler = createHandler(b3ndClient, config);

  // Create Hono app
  const app = new Hono();

  // CORS middleware
  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["*"],
  }));

  // Route all requests to handler
  app.all("*", async (c) => {
    const response = await handler(c.req.raw);
    return response;
  });

  return app;
}

/**
 * Start the server.
 */
export function startServer(config: HostConfig) {
  const app = createServer(config);

  const targetDisplay = config.target
    ? config.target.length > 50
      ? config.target.substring(0, 47) + "..."
      : config.target
    : "(not configured)";

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   public-static host                       ║
╠═══════════════════════════════════════════════════════════╣
║  Port:     ${config.port.toString().padEnd(45)}║
║  Backend:  ${config.backendUrl.substring(0, 45).padEnd(45)}║
║  Target:   ${targetDisplay.padEnd(45)}║
║  Pubkey:   ${config.hostPubkey.substring(0, 16)}...${" ".repeat(24)}║
╚═══════════════════════════════════════════════════════════╝

The host serves content from: target + request_path
Example: GET /index.html -> reads {target}/index.html

System endpoints:
  GET /_health    Health check
  GET /_pubkey    Get host public key
  GET /_info      Get host info
  GET /_target    Show current target

Ready to serve!
`);

  Deno.serve({ port: config.port }, app.fetch);
}
