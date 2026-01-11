/**
 * HTTP Header Utilities
 *
 * Simple utilities for content type detection and cache headers.
 */

/**
 * Common MIME types by extension.
 */
const MIME_TYPES: Record<string, string> = {
  // Web
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",

  // Media
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",

  // Documents
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
};

/**
 * Get content type for a file path.
 */
export function getContentType(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Get cache headers for a file path.
 * - Hashed assets: immutable, cache forever
 * - HTML: short cache, must revalidate
 * - Others: medium cache
 */
export function getCacheHeaders(filePath: string): Record<string, string> {
  // Hashed assets (e.g., main.abc123.js)
  if (/\.[a-f0-9]{6,}\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|svg|webp|avif|ico)$/i.test(filePath)) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }

  // HTML - always revalidate
  if (/\.html?$/i.test(filePath)) {
    return { "Cache-Control": "public, max-age=0, must-revalidate" };
  }

  // JSON - short cache
  if (/\.json$/i.test(filePath)) {
    return { "Cache-Control": "public, max-age=60" };
  }

  // Default
  return { "Cache-Control": "public, max-age=3600" };
}

/**
 * Build response headers for a file.
 */
export function buildResponseHeaders(filePath: string): Headers {
  const headers = new Headers();

  headers.set("Content-Type", getContentType(filePath));

  const cacheHeaders = getCacheHeaders(filePath);
  for (const [key, value] of Object.entries(cacheHeaders)) {
    headers.set(key, value);
  }

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Access-Control-Allow-Origin", "*");

  return headers;
}

/**
 * Build error response headers.
 */
export function buildErrorHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return headers;
}
