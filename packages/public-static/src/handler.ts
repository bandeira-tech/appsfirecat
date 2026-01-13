/**
 * Request Handler for public-static host.
 *
 * Simple B3nd HTTP gateway - the host has a target base URI,
 * and HTTP request paths are appended to it.
 *
 * Example:
 *   target = "immutable://accounts/abc123/site/"
 *   GET /index.html -> reads immutable://accounts/abc123/site/index.html
 *   GET /css/styles.css -> reads immutable://accounts/abc123/site/css/styles.css
 */

import {
  buildErrorHeaders,
  type B3ndReader,
  type HostConfig,
  type HostInfoResponse,
} from "../../host-protocol/mod.ts";

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
 * Check if a path has a file extension.
 * Used to distinguish files from directories when deciding whether to try index.html.
 */
function hasFileExtension(path: string): boolean {
  const lastSegment = path.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

/**
 * Check if data is a link to another B3nd resource.
 *
 * A link is simply a string that is a B3nd URI.
 * No special object format - just a plain URI string.
 *
 * Metadata, if needed, lives at a separate deterministic location
 * (e.g., {resource}.meta or {resource}/_meta).
 */
function isLink(data: unknown): string | null {
  if (typeof data === "string") {
    if (data.startsWith("immutable://") || data.startsWith("mutable://")) {
      return data;
    }
  }
  return null;
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

    // API v1 endpoints
    if (path === "/api/v1/health") {
      return handleHealth(config);
    }
    if (path === "/api/v1/info") {
      return handleInfo(config);
    }
    if (path === "/api/v1/pubkey") {
      return handlePubkey(config);
    }
    if (path === "/api/v1/target") {
      return handleTarget(config);
    }

    // Content serving: /api/v1/serve/*
    if (path.startsWith("/api/v1/serve/") || path === "/api/v1/serve") {
      return handleServe(client, config, path);
    }

    // Unknown endpoint
    return new Response("Not found", {
      status: 404,
      headers: buildErrorHeaders(),
    });
  };
}

/**
 * Handle content serving via /api/v1/serve/*
 */
async function handleServe(
  client: B3ndReader,
  config: HostConfig,
  path: string,
): Promise<Response> {
  // Extract the content path from /api/v1/serve/...
  const contentPath = path.replace(/^\/api\/v1\/serve\/?/, "");

  // Resolve the target base URI
  const target = await resolveTarget(client, config);
  if (!target) {
    return new Response("No target configured", {
      status: 503,
      headers: buildErrorHeaders(),
    });
  }

  // Build the full B3nd URI: target + content path
  const normalizedTarget = target.endsWith("/") ? target : `${target}/`;
  const b3ndUri = `${normalizedTarget}${contentPath}`;

  try {
    // Try the exact path first
    let response = await handleContent(client, b3ndUri);

    // If not found and path looks like a directory (not a file), try index.html
    if (response.status === 404 && !hasFileExtension(contentPath)) {
      const indexUri = b3ndUri.endsWith("/")
        ? `${b3ndUri}index.html`
        : `${b3ndUri}/index.html`;
      response = await handleContent(client, indexUri);
    }

    return response;
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Resolve the target base URI.
 *
 * Resolution rules:
 * - If target ends with "/", use it directly as the base path
 * - If target is mutable:// and doesn't end with "/", read it as a pointer
 * - Otherwise use it directly
 */
async function resolveTarget(
  client: B3ndReader,
  config: HostConfig,
): Promise<string | null> {
  const { target } = config;
  if (!target) return null;

  // If target ends with "/", it's already a base path - use directly
  if (target.endsWith("/")) {
    return target;
  }

  // If target is mutable and doesn't end with "/", it's a pointer - resolve it
  if (target.startsWith("mutable://")) {
    const result = await client.read<string>(target);
    if (result.success && result.record?.data) {
      const resolved = unwrapData(result.record.data);
      // The pointer should contain a URI string
      if (typeof resolved === "string") {
        return resolved;
      }
    }
    // Fall through to use target directly if resolution fails
  }

  // Use target directly
  return target;
}

/**
 * Handle target endpoint - show current target config.
 */
function handleTarget(config: HostConfig): Response {
  return new Response(config.target || "No target configured", {
    status: config.target ? 200 : 404,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Max depth for following links (prevent infinite loops) */
const MAX_LINK_DEPTH = 5;

/**
 * Handle content request - read from B3nd, follow links, and serve.
 *
 * Link resolution:
 * 1. Try exact URI first
 * 2. If not found, walk up the path looking for a link
 * 3. If link found, append remaining path and follow it
 *
 * Example:
 *   Request: mutable://provider/hosted/user1/index.html
 *   Not found, try: mutable://provider/hosted/user1
 *   Found link: "immutable://user1/site/"
 *   Follow: immutable://user1/site/index.html
 */
async function handleContent(
  client: B3ndReader,
  uri: string,
  depth = 0,
): Promise<Response> {
  // Prevent infinite link loops
  if (depth > MAX_LINK_DEPTH) {
    return new Response(`Too many link redirects (max ${MAX_LINK_DEPTH})`, {
      status: 508, // Loop Detected
      headers: buildErrorHeaders(),
    });
  }

  // Try exact URI first
  const result = await client.read<unknown>(uri);

  if (result.success && result.record?.data) {
    const data = unwrapData(result.record.data);

    // Check if this is a link
    const linkTarget = isLink(data);
    if (linkTarget) {
      return handleContent(client, linkTarget, depth + 1);
    }

    // Not a link - serve the content
    return serveContent(data, uri);
  }

  // Not found - walk up path looking for a link
  const linkResult = await findLinkInPath(client, uri);
  if (linkResult) {
    const { linkTarget, remainingPath } = linkResult;
    const normalizedLink = linkTarget.endsWith("/") ? linkTarget : `${linkTarget}/`;
    const newUri = `${normalizedLink}${remainingPath}`;
    return handleContent(client, newUri, depth + 1);
  }

  // No link found - return 404
  return new Response(`Not found: ${uri}`, {
    status: 404,
    headers: buildErrorHeaders(),
  });
}

/**
 * Walk up the URI path looking for a link.
 * Returns the link target and the remaining path to append.
 */
async function findLinkInPath(
  client: B3ndReader,
  uri: string,
): Promise<{ linkTarget: string; remainingPath: string } | null> {
  // Parse URI: protocol://domain/path/to/file
  const match = uri.match(/^([^:]+:\/\/[^/]+)\/(.+)$/);
  if (!match) return null;

  const base = match[1]; // e.g., "mutable://accounts"
  const fullPath = match[2]; // e.g., "provider/hosted/user1/index.html"
  const segments = fullPath.split("/");

  // Walk up from the deepest segment (excluding the last one which we already tried)
  for (let i = segments.length - 1; i >= 1; i--) {
    const checkPath = segments.slice(0, i).join("/");
    const checkUri = `${base}/${checkPath}`;
    const remainingPath = segments.slice(i).join("/");

    const result = await client.read<unknown>(checkUri);
    if (result.success && result.record?.data) {
      const data = unwrapData(result.record.data);
      const linkTarget = isLink(data);
      if (linkTarget) {
        return { linkTarget, remainingPath };
      }
    }
  }

  return null;
}

/**
 * Serve content with appropriate headers.
 */
function serveContent(data: unknown, uri: string): Response {
  const headers = new Headers();

  if (typeof data === "string") {
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data, { status: 200, headers });
  }

  if (data instanceof Uint8Array) {
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(data, { status: 200, headers });
  }

  if (ArrayBuffer.isView(data)) {
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { status: 200, headers });
  }

  // Object/JSON content
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
  config: HostConfig,
): Promise<Response> {
  let backendStatus: "ok" | "error" = "error";

  try {
    // Check backend health endpoint
    const healthUrl = `${config.backendUrl}/api/v1/health`;
    const res = await fetch(healthUrl);
    if (res.ok) {
      backendStatus = "ok";
    }
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
    capabilities: ["decrypt"],
    target: config.target,
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
