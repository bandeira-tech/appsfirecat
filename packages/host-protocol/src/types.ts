/**
 * Host Protocol Types
 *
 * Minimal types for host implementations.
 * A host is simply a "tap" that serves content from a B3nd path over HTTP.
 */

/**
 * Host configuration.
 */
export interface HostConfig {
  /** B3nd backend URL */
  backendUrl: string;

  /**
   * Target B3nd URI to serve from.
   *
   * Can be:
   * - An immutable path: "immutable://accounts/abc123/site/"
   * - A mutable pointer: "mutable://accounts/abc123/target" (resolved to get actual path)
   * - An open path: "immutable://open/myproject/v1/"
   */
  target?: string;

  /** Server port */
  port: number;

  /** Host's X25519 public key (hex) - for encryption/identity */
  hostPubkey: string;

  /** Host's X25519 private key (hex) - for decryption */
  hostPrivateKey: string;

  /**
   * Primary domain for API endpoints.
   * Requests to other domains are treated as custom domain lookups.
   * If not set, defaults to *.fire.cat and localhost.
   */
  primaryDomain?: string;
}

/**
 * B3nd client interface - subset needed for reading.
 */
export interface B3ndReader {
  read<T>(uri: string): Promise<ReadResult<T>>;
}

/**
 * Read result from B3nd.
 */
export interface ReadResult<T> {
  success: boolean;
  error?: string;
  record?: {
    uri: string;
    data: T;
    timestamp?: number;
  };
}

/**
 * Health check response.
 */
export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  timestamp: number;
  backend?: {
    url: string;
    status: "ok" | "error";
  };
  target?: string;
}

/**
 * Host info response.
 */
export interface HostInfoResponse {
  /** Host's public key */
  pubkey: string;

  /** Host type */
  type: string;

  /** Version */
  version: string;

  /** Capabilities */
  capabilities: string[];

  /** Current target (if configured) */
  target?: string;
}
