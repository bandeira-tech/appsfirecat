/**
 * Host Protocol Types
 *
 * These types define the contract between B3nd content and host implementations.
 * All host implementations must understand and work with these structures.
 */

/**
 * Request to serve content from a host.
 * The proxy layer transforms domain requests into these.
 */
export interface HostRequest {
  /** The app's public key (Ed25519 hex) */
  appPubkey: string;

  /** Requested path within the build (e.g., "/index.html", "/assets/main.js") */
  path: string;

  /** Optional: specific build hash for previews. If omitted, uses current target. */
  buildHash?: string;
}

/**
 * Resolved build target - points to a specific build in B3nd.
 */
export interface BuildTarget {
  /** The app's public key */
  appPubkey: string;

  /** The build hash being served */
  buildHash: string;

  /** Full base URI for this build */
  baseUri: string; // immutable://accounts/{appPubkey}/builds/{buildHash}

  /** Version string from target (if available) */
  version?: string;
}

/**
 * Target pointer stored in B3nd.
 * Lives at: mutable://accounts/{appPubkey}/target
 */
export interface TargetPointer {
  /** Hash of the current build to serve */
  buildHash: string;

  /** Semantic version or tag */
  version?: string;

  /** When this target was set */
  updatedAt: number;

  /** Who set this target (pubkey) */
  updatedBy?: string;
}

/**
 * Build manifest - the source of truth for a build.
 * Lives at: immutable://accounts/{appPubkey}/builds/{buildHash}/manifest.json
 */
export interface Manifest {
  /** Manifest schema version */
  manifestVersion: "1";

  /** Build hash (should match the directory) */
  buildHash: string;

  /** Semantic version or tag */
  version?: string;

  /** When this build was created */
  createdAt: number;

  /** Who created this build (pubkey) */
  createdBy?: string;

  /** File listing */
  files: Record<string, FileEntry>;

  /** Routing configuration */
  routing?: RoutingConfig;

  /** Encryption configuration */
  encryption?: EncryptionConfig;

  /** Cache header configuration */
  headers?: HeadersConfig;
}

/**
 * Entry for a single file in the build.
 */
export interface FileEntry {
  /** File size in bytes (after encryption, if encrypted) */
  size: number;

  /** MIME type */
  contentType: string;

  /** SHA-256 hash of content (before encryption) */
  hash?: string;

  /** Whether this file is encrypted */
  encrypted?: boolean;

  /** Whether this file is gzip compressed (before encryption) */
  gzipped?: boolean;
}

/**
 * Routing configuration for SPAs and custom routing.
 */
export interface RoutingConfig {
  /** Enable SPA mode - unmatched paths fall back to entrypoint */
  spa?: boolean;

  /** Entrypoint file for SPA fallback (default: "index.html") */
  entrypoint?: string;

  /** Custom redirects */
  redirects?: Record<string, string>;

  /** Custom rewrites (internal, no redirect) */
  rewrites?: Record<string, string>;
}

/**
 * Encryption configuration for the build.
 */
export interface EncryptionConfig {
  /** Whether encryption is enabled */
  enabled: boolean;

  /**
   * Wrapped content keys per host.
   * Key: host public key (X25519 hex)
   * Value: content key encrypted to that host's public key
   */
  keys?: Record<string, string>;

  /**
   * Single wrapped key (for single-host case).
   * If both `keys` and `wrappedKey` exist, prefer `keys`.
   */
  wrappedKey?: string;

  /** Host public key this was encrypted to (for single-host case) */
  hostPubkey?: string;
}

/**
 * Cache header configuration.
 */
export interface HeadersConfig {
  /** Default headers for all files */
  default?: Record<string, string>;

  /** Headers by glob pattern */
  patterns?: Record<string, Record<string, string>>;
}

/**
 * Context for decryption operations.
 */
export interface DecryptContext {
  /** Host's private key (X25519 hex) */
  hostPrivateKey: string;

  /** Host's public key (X25519 hex) - for looking up wrapped key */
  hostPubkey: string;

  /** The manifest (contains wrapped keys) */
  manifest: Manifest;
}

/**
 * Result of resolving a path within a build.
 */
export interface ResolvedPath {
  /** The actual file path to serve */
  filePath: string;

  /** The file entry from manifest */
  file: FileEntry;

  /** Whether this was a fallback (SPA, error page, etc.) */
  fallback?: boolean;
}

/**
 * Host configuration.
 */
export interface HostConfig {
  /** B3nd backend URL */
  backendUrl: string;

  /** Host's X25519 private key (hex) */
  hostPrivateKey: string;

  /** Host's X25519 public key (hex) */
  hostPubkey: string;

  /** Server port */
  port: number;

  /** Optional: only serve these apps */
  allowedApps?: string[];

  /** Optional: cache TTL for target lookups (ms) */
  targetCacheTtl?: number;

  /** Optional: cache TTL for manifests (ms) */
  manifestCacheTtl?: number;

  /** URI pattern: "accounts" (requires auth) or "open" (no auth, for testing) */
  uriPattern?: "accounts" | "open";
}

/**
 * Health check response.
 */
export interface HealthResponse {
  status: "ok" | "error";
  timestamp: number;
  backend?: {
    url: string;
    status: "ok" | "error";
  };
}

/**
 * Host public info response.
 */
export interface HostInfoResponse {
  /** Host's X25519 public key */
  pubkey: string;

  /** Host implementation type */
  type: "public-static" | "shell-server" | "edge-worker";

  /** Host version */
  version: string;

  /** Capabilities */
  capabilities: ("decrypt" | "shell" | "preview")[];
}
