/**
 * HTTP Server for public-static host.
 *
 * Uses Hono for routing and the native Deno HTTP server.
 */

import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import type { HostConfig } from "@appsfirecat/host-protocol";
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

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   public-static host                       ║
╠═══════════════════════════════════════════════════════════╣
║  Port:     ${config.port.toString().padEnd(45)}║
║  Backend:  ${config.backendUrl.substring(0, 45).padEnd(45)}║
║  Pubkey:   ${config.hostPubkey.substring(0, 16)}...${" ".repeat(24)}║
╚═══════════════════════════════════════════════════════════╝

Endpoints:
  GET /{appPubkey}/{path}    Serve content
  GET /{appPubkey}/_target   Get current target info
  GET /_health               Health check
  GET /_pubkey               Get host public key
  GET /_info                 Get host info

Ready to serve!
`);

  Deno.serve({ port: config.port }, app.fetch);
}
