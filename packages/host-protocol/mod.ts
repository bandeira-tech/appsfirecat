/**
 * Host Protocol
 *
 * Shared types and utilities for Apps Host implementations.
 * All host implementations should import from this package.
 */

// Types
export type {
  BuildTarget,
  DecryptContext,
  EncryptionConfig,
  FileEntry,
  HeadersConfig,
  HealthResponse,
  HostConfig,
  HostInfoResponse,
  HostRequest,
  Manifest,
  ResolvedPath,
  RoutingConfig,
  TargetPointer,
} from "./src/types.ts";

// Resolution
export {
  buildBaseUri,
  fileUri,
  getManifest,
  resolvePath,
  ResolveError,
  resolveTarget,
  targetUri,
  type B3ndReader,
  type UriPattern,
} from "./src/resolve.ts";

// Decryption
export {
  bytesToHex,
  decrypt,
  decryptContent,
  DecryptError,
  getWrappedKey,
  hexToBytes,
  isEncrypted,
  unwrapContentKey,
} from "./src/decrypt.ts";

// Headers
export {
  buildErrorHeaders,
  buildResponseHeaders,
  getCacheHeaders,
  getContentType,
} from "./src/headers.ts";
