/**
 * Host Protocol
 *
 * Minimal types for host implementations.
 * A host is simply a "tap" that serves content from a B3nd path over HTTP.
 */

// Types
export type {
  B3ndReader,
  HealthResponse,
  HostConfig,
  HostInfoResponse,
  ReadResult,
} from "./src/types.ts";

// Headers
export {
  buildErrorHeaders,
  buildResponseHeaders,
  getCacheHeaders,
  getContentType,
} from "./src/headers.ts";
