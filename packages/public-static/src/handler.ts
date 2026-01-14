/**
 * Request Handler for public-static host.
 *
 * Supports two modes:
 *
 * 1. API Mode (primary domain):
 *    - /api/v1/health, /api/v1/info, etc.
 *    - /api/v1/serve/* serves from configured TARGET
 *
 * 2. Custom Domain Mode:
 *    - Host header is looked up in B3nd domain registry
 *    - Content served directly at / (no /api/v1/serve/ prefix)
 *    - Registry: mutable://open/domains/{domain} → base URI
 *
 * Protocol-based resolution:
 *   - link://... → read value (a URI), recursively resolve
 *   - blob://... → read binary content, serve with MIME from path context
 *   - mutable://, immutable:// → read and serve directly
 *
 * Example with blobs + links:
 *   custom.example.com → lookup mutable://open/domains/custom.example.com
 *   Found base: "link://accounts/abc123/mysite/v1234567890/"
 *   Request: /css/styles.css
 *   Compose: link://accounts/abc123/mysite/v1234567890/css/styles.css
 *   Read link → "blob://open/sha256:def456..."
 *   Read blob → serve CSS content
 */

import {
  buildErrorHeaders,
  type B3ndReader,
  type HostConfig,
  type HostInfoResponse,
} from "../../host-protocol/mod.ts";

/** Domain mapping stored in B3nd */
interface DomainMapping {
  target: string;
  owner?: string;
  created?: number;
}

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
 * Extract the protocol from a URI.
 * Example: "link://accounts/foo" → "link"
 */
function getProtocol(uri: string): string {
  const match = uri.match(/^([a-z]+):\/\//);
  return match ? match[1] : "";
}

/**
 * Check if a host is a custom domain (not the primary/API domain).
 *
 * Primary domain: where API endpoints are served (/api/v1/*)
 * Custom domains: looked up in B3nd registry, content served at /
 */
function isCustomDomain(host: string, config: HostConfig): boolean {
  // Strip port if present
  const domain = host.split(":")[0].toLowerCase();

  // Always treat localhost as primary (for dev)
  if (domain === "localhost" || domain === "127.0.0.1") {
    return false;
  }

  // If primary domain is configured, only that is primary
  if (config.primaryDomain) {
    return domain !== config.primaryDomain.toLowerCase();
  }

  // No primary domain configured - treat ALL domains as custom
  // This allows any domain to be served via registry lookup
  return true;
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

    // Get original host from headers
    // Cloudflare Tunnels preserve Host header, but check X-Forwarded-Host as fallback
    const host = req.headers.get("host") ||
      req.headers.get("x-forwarded-host") ||
      "";

    // Check if this is a custom domain request
    if (isCustomDomain(host, config)) {
      return handleCustomDomain(client, host, path);
    }

    // API v1 endpoints (primary domain)
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

    // Domain check endpoint for TLS validation (Caddy on_demand)
    if (path === "/api/v1/domain-check") {
      return handleDomainCheck(client, url);
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

  try {
    return await handleContent(client, target, contentPath);
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
 * Handle custom domain requests.
 * Looks up domain mapping in B3nd and serves content.
 *
 * The domain mapping contains a base URI (e.g., "link://accounts/.../v123/")
 * that we compose with the request path to get the full URI to resolve.
 */
async function handleCustomDomain(
  client: B3ndReader,
  host: string,
  path: string,
): Promise<Response> {
  // Strip port if present
  const domain = host.split(":")[0].toLowerCase();

  // Look up domain mapping in B3nd
  const mappingUri = `mutable://open/domains/${domain}`;
  const result = await client.read<DomainMapping | string>(mappingUri);

  if (!result.success || !result.record?.data) {
    return new Response(`Domain not configured: ${domain}`, {
      status: 404,
      headers: buildErrorHeaders(),
    });
  }

  const data = unwrapData(result.record.data);

  // Support both simple string (just the base URI) and object with metadata
  let baseUri: string;
  if (typeof data === "string") {
    baseUri = data;
  } else if (data && typeof data === "object" && "target" in data) {
    baseUri = data.target;
  } else {
    return new Response(`Invalid domain mapping for: ${domain}`, {
      status: 500,
      headers: buildErrorHeaders(),
    });
  }

  // Build content path (remove leading slash)
  const contentPath = path === "/" ? "" : path.slice(1);

  try {
    return await handleContent(client, baseUri, contentPath);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Handle domain check for TLS validation.
 * Used by Caddy's on_demand TLS to verify domain ownership.
 */
async function handleDomainCheck(
  client: B3ndReader,
  url: URL,
): Promise<Response> {
  const domain = url.searchParams.get("domain");

  if (!domain) {
    return new Response("Missing domain parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Check if domain is registered in B3nd
  const mappingUri = `mutable://open/domains/${domain.toLowerCase()}`;
  const result = await client.read<DomainMapping | string>(mappingUri);

  if (result.success && result.record?.data) {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Domain not registered", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
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
const MAX_LINK_DEPTH = 10;

/**
 * Resolve a URI based on its protocol.
 *
 * Protocol-based resolution:
 *   - link://... → read value (a URI string), recursively resolve that URI
 *   - blob://... → read binary content, return as-is
 *   - mutable://, immutable:// → read and return as-is (no automatic following)
 *
 * @param client - B3nd client
 * @param uri - The URI to resolve
 * @param originalPath - Original request path for MIME type inference
 * @param depth - Current recursion depth
 */
async function resolveByProtocol(
  client: B3ndReader,
  uri: string,
  originalPath: string,
  depth = 0,
): Promise<Response> {
  // Prevent infinite loops
  if (depth > MAX_LINK_DEPTH) {
    return new Response(`Too many link redirects (max ${MAX_LINK_DEPTH})`, {
      status: 508, // Loop Detected
      headers: buildErrorHeaders(),
    });
  }

  const protocol = getProtocol(uri);

  switch (protocol) {
    case "link": {
      // link:// protocol - read value and follow it
      const result = await client.read<unknown>(uri);

      if (!result.success || !result.record?.data) {
        return new Response(`Link not found: ${uri}`, {
          status: 404,
          headers: buildErrorHeaders(),
        });
      }

      const data = unwrapData(result.record.data);

      // Link value must be a string URI
      if (typeof data !== "string") {
        return new Response(`Invalid link value at ${uri}: expected URI string`, {
          status: 500,
          headers: buildErrorHeaders(),
        });
      }

      // Recursively resolve the target URI
      return resolveByProtocol(client, data, originalPath, depth + 1);
    }

    case "blob": {
      // blob:// protocol - read and serve binary content
      const result = await client.read<unknown>(uri);

      if (!result.success || !result.record?.data) {
        return new Response(`Blob not found: ${uri}`, {
          status: 404,
          headers: buildErrorHeaders(),
        });
      }

      // Unwrap auth wrapper if present, then serve content
      const data = unwrapData(result.record.data);
      return serveContent(data, originalPath);
    }

    case "mutable":
    case "immutable": {
      // Direct storage - read and serve as-is (no automatic link following)
      const result = await client.read<unknown>(uri);

      if (!result.success || !result.record?.data) {
        return new Response(`Not found: ${uri}`, {
          status: 404,
          headers: buildErrorHeaders(),
        });
      }

      const data = unwrapData(result.record.data);
      return serveContent(data, originalPath || uri);
    }

    default:
      return new Response(`Unsupported protocol: ${protocol}`, {
        status: 400,
        headers: buildErrorHeaders(),
      });
  }
}

/**
 * Handle content request - compose URI from base + path, then resolve by protocol.
 *
 * @param client - B3nd client
 * @param baseUri - Base URI (from domain mapping or config target)
 * @param contentPath - Content path to append
 */
async function handleContent(
  client: B3ndReader,
  baseUri: string,
  contentPath: string,
): Promise<Response> {
  // Compose full URI: base + path
  const normalizedBase = baseUri.endsWith("/") ? baseUri : `${baseUri}/`;
  const fullUri = contentPath ? `${normalizedBase}${contentPath}` : normalizedBase;

  // Try exact path first
  let response = await resolveByProtocol(client, fullUri, contentPath);

  // If not found and path looks like a directory, try index.html
  if (response.status === 404 && !hasFileExtension(contentPath)) {
    // Normalize: remove trailing slash before adding /index.html
    const basePath = contentPath.replace(/\/$/, "");
    const indexPath = basePath ? `${basePath}/index.html` : "index.html";
    const indexUri = `${normalizedBase}${indexPath}`;
    response = await resolveByProtocol(client, indexUri, indexPath);
  }

  return response;
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
    return new Response(data as unknown as BodyInit, { status: 200, headers });
  }

  if (ArrayBuffer.isView(data)) {
    headers.set("Content-Type", getContentTypeFromUri(uri));
    headers.set("Cache-Control", getCacheControl(uri));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Response(bytes as unknown as BodyInit, { status: 200, headers });
  }

  // Object/JSON content
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", getCacheControl(uri));
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers });
}

/**
 * MIME type mapping from file extension.
 */
const MIME_TYPES: Record<string, string> = {
  // Text
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  // Audio/Video
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  // Other
  wasm: "application/wasm",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
};

/**
 * Guess content type from URI path.
 */
function getContentTypeFromUri(uri: string): string {
  const path = uri.split("/").pop() ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Determine cache control based on path and context.
 * Uses the original request path for cache decisions since blob URIs
 * don't have meaningful extensions.
 */
function getCacheControl(path: string): string {
  // Check for hashed assets (e.g., styles.abc123.css)
  const filename = path.split("/").pop() ?? "";
  if (/\.[a-f0-9]{6,}\.(js|css|woff2?)$/i.test(filename)) {
    return "public, max-age=31536000, immutable";
  }

  // Default - reasonable cache for static sites
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
