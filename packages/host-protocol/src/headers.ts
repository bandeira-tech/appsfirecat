/**
 * HTTP Header Utilities
 *
 * Handles generating appropriate cache and content headers for responses.
 */

import type { FileEntry, HeadersConfig, Manifest } from "./types.ts";

/**
 * Default cache headers by file pattern.
 */
const DEFAULT_CACHE_RULES: Array<{ pattern: RegExp; headers: Record<string, string> }> = [
  // Hashed assets (e.g., main.abc123.js) - cache forever
  {
    pattern: /\.[a-f0-9]{6,}\.(js|css|woff2?|ttf|eot)$/i,
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  },
  // Images with hash
  {
    pattern: /\.[a-f0-9]{6,}\.(png|jpg|jpeg|gif|svg|webp|avif|ico)$/i,
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  },
  // HTML files - no cache, always revalidate
  {
    pattern: /\.html?$/i,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  },
  // JSON files - short cache
  {
    pattern: /\.json$/i,
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  },
  // Default for everything else
  {
    pattern: /.*/,
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  },
];

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
export function getContentType(filePath: string, fileEntry?: FileEntry): string {
  // Prefer explicit content type from manifest
  if (fileEntry?.contentType) {
    return fileEntry.contentType;
  }

  // Derive from extension
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Get cache headers for a file path.
 */
export function getCacheHeaders(
  filePath: string,
  headersConfig?: HeadersConfig,
): Record<string, string> {
  // Check manifest patterns first
  if (headersConfig?.patterns) {
    for (const [pattern, headers] of Object.entries(headersConfig.patterns)) {
      if (matchGlob(filePath, pattern)) {
        return { ...headersConfig.default, ...headers };
      }
    }
  }

  // Check manifest defaults
  if (headersConfig?.default) {
    return headersConfig.default;
  }

  // Use default rules
  for (const rule of DEFAULT_CACHE_RULES) {
    if (rule.pattern.test(filePath)) {
      return rule.headers;
    }
  }

  return {};
}

/**
 * Build full response headers for a file.
 */
export function buildResponseHeaders(
  filePath: string,
  fileEntry: FileEntry,
  manifest: Manifest,
  options?: {
    etag?: string;
    gzipped?: boolean;
  },
): Headers {
  const headers = new Headers();

  // Content type
  headers.set("Content-Type", getContentType(filePath, fileEntry));

  // Cache headers
  const cacheHeaders = getCacheHeaders(filePath, manifest.headers);
  for (const [key, value] of Object.entries(cacheHeaders)) {
    headers.set(key, value);
  }

  // ETag if provided
  if (options?.etag) {
    headers.set("ETag", `"${options.etag}"`);
  } else if (fileEntry.hash) {
    // Use file hash as ETag
    headers.set("ETag", `"${fileEntry.hash.substring(0, 16)}"`);
  }

  // Content encoding if gzipped
  if (options?.gzipped || fileEntry.gzipped) {
    headers.set("Content-Encoding", "gzip");
  }

  // Security headers
  headers.set("X-Content-Type-Options", "nosniff");

  // CORS - allow all for static assets
  // (The proxy layer can restrict this further)
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

/**
 * Simple glob pattern matching.
 * Supports: * (any chars), ** (any path segments)
 */
function matchGlob(path: string, pattern: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*\*/g, "<<<GLOBSTAR>>>") // Temp placeholder
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/<<<GLOBSTAR>>>/g, ".*"); // ** matches anything

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}
