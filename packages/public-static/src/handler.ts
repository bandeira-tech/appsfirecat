/**
 * Request Handler for public-static host.
 *
 * Simple B3nd HTTP gateway - the URL path directly maps to B3nd URI.
 *
 * URL format: /{protocol}/{domain}/{path...}
 * Examples:
 *   /immutable/accounts/abc123/builds/def456/index.html
 *   /mutable/accounts/abc123/target
 *   /immutable/open/some/path
 */

import {
  buildErrorHeaders,
  buildResponseHeaders,
  decrypt,
  isEncrypted,
  type B3ndReader,
  type HostConfig,
  type HostInfoResponse,
  type Manifest,
} from "@appsfirecat/host-protocol";

/**
 * Authenticated message wrapper from B3nd.
 */
interface AuthenticatedMessage<T> {
  auth?: Array<{ pubkey: string; signature: string }>;
  payload: T;
}

/**
 * Unwrap authenticated message data.
 */
function unwrapData<T>(data: T | AuthenticatedMessage<T>): T {
  if (data && typeof data === "object" && "payload" in data) {
    return (data as AuthenticatedMessage<T>).payload;
  }
  return data as T;
}

/**
 * Create a request handler for the public-static host.
 */
export function createHandler(
  client: B3ndReader,
  config: HostConfig,
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // System endpoints
    if (path === "/_health") {
      return handleHealth(client, config);
    }
    if (path === "/_pubkey") {
      return handlePubkey(config);
    }
    if (path === "/_info") {
      return handleInfo(config);
    }

    // Parse B3nd URI from path: /{protocol}/{domain}/{path...}
    // e.g., /immutable/accounts/abc123/builds/def456/index.html
    const match = path.match(/^\/([^/]+)\/(.+)$/);
    if (!match) {
      return new Response(
        "Invalid path. Expected: /{protocol}/{domain}/{path...}\n" +
        "Example: /immutable/accounts/{pubkey}/builds/{hash}/index.html",
        { status: 400, headers: buildErrorHeaders() },
      );
    }

    const protocol = match[1]; // "immutable" or "mutable"
    const rest = match[2]; // "accounts/abc123/builds/def456/index.html"

    // Construct B3nd URI
    const b3ndUri = `${protocol}://${rest}`;

    try {
      return await handleContent(client, config, b3ndUri);
    } catch (error) {
      return handleError(error);
    }
  };
}

/**
 * Handle content request - just read from B3nd and serve.
 */
async function handleContent(
  client: B3ndReader,
  config: HostConfig,
  uri: string,
): Promise<Response> {
  // Read from B3nd
  const result = await client.read<unknown>(uri);

  if (!result.success) {
    return new Response(`Not found: ${uri}\nError: ${result.error}`, {
      status: 404,
      headers: buildErrorHeaders(),
    });
  }

  if (!result.record?.data) {
    return new Response(`No data at: ${uri}`, {
      status: 404,
      headers: buildErrorHeaders(),
    });
  }

  // Unwrap authenticated message
  let data = unwrapData(result.record.data);

  // Determine content type and format response
  const headers = new Headers();

  if (typeof data === "string") {
    // String content - serve as text
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data, { status: 200, headers });
  }

  if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
    // Binary content
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data as Uint8Array, { status: 200, headers });
  }

  // Object/JSON content - serve as JSON
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", getCacheControl(uri));
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers });
}

/**
 * Guess content type from URI path.
 */
function getContentTypeFromUri(uri: string): string {
  const path = uri.split("/").pop() ?? "";

  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";

  return "application/octet-stream";
}

/**
 * Determine cache control based on URI.
 */
function getCacheControl(uri: string): string {
  // Mutable content - short cache
  if (uri.startsWith("mutable://")) {
    return "public, max-age=5";
  }

  // Immutable content - can cache longer
  // Check for hashed assets
  const path = uri.split("/").pop() ?? "";
  if (/\.[a-f0-9]{6,}\.(js|css|woff2?)$/i.test(path)) {
    return "public, max-age=31536000, immutable";
  }

  // Default for immutable
  return "public, max-age=3600";
}

/**
 * Handle health check.
 */
async function handleHealth(
  client: B3ndReader,
  config: HostConfig,
): Promise<Response> {
  let backendStatus: "ok" | "error" = "error";

  try {
    // Simple connectivity check
    const result = await client.read("mutable://open/health");
    backendStatus = "ok";
  } catch {
    backendStatus = "error";
  }

  const response = {
    status: backendStatus === "ok" ? "ok" : "degraded",
    timestamp: Date.now(),
    backend: {
      url: config.backendUrl,
      status: backendStatus,
    },
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: backendStatus === "ok" ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle pubkey request.
 */
function handlePubkey(config: HostConfig): Response {
  return new Response(config.hostPubkey, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Handle info request.
 */
function handleInfo(config: HostConfig): Response {
  const info: HostInfoResponse = {
    pubkey: config.hostPubkey,
    type: "public-static",
    version: "0.1.0",
    capabilities: ["decrypt", "preview"],
  };

  return new Response(JSON.stringify(info, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle errors.
 */
function handleError(error: unknown): Response {
  console.error("Error:", error);
  const message = error instanceof Error ? error.message : "Unknown error";
  return new Response(`Error: ${message}`, {
    status: 500,
    headers: buildErrorHeaders(),
  });
}
