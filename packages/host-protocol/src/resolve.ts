/**
 * Target and Path Resolution
 *
 * Handles resolving which build to serve and which file within the build.
 */

import type {
  BuildTarget,
  HostRequest,
  Manifest,
  ResolvedPath,
  TargetPointer,
} from "./types.ts";

/**
 * Interface for B3nd client operations needed by resolver.
 */
export interface B3ndReader {
  read<T>(uri: string): Promise<{ success: boolean; record?: { data: T }; error?: string }>;
}

/**
 * URI pattern configuration.
 * Defaults to 'accounts' protocol (requires auth).
 * Use 'open' for testing without auth.
 */
export type UriPattern = "accounts" | "open";

/**
 * Build the base URI for a build.
 */
export function buildBaseUri(
  appPubkey: string,
  buildHash: string,
  pattern: UriPattern = "accounts",
): string {
  if (pattern === "open") {
    return `immutable://open/apps/${appPubkey}/builds/${buildHash}`;
  }
  return `immutable://accounts/${appPubkey}/builds/${buildHash}`;
}

/**
 * Build the target URI for an app.
 */
export function targetUri(appPubkey: string, pattern: UriPattern = "accounts"): string {
  if (pattern === "open") {
    return `mutable://open/apps/${appPubkey}/target`;
  }
  return `mutable://accounts/${appPubkey}/target`;
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
 * Data from accounts protocol comes wrapped with auth + payload.
 */
function unwrapData<T>(data: T | AuthenticatedMessage<T>): T {
  if (data && typeof data === "object" && "payload" in data) {
    return (data as AuthenticatedMessage<T>).payload;
  }
  return data as T;
}

/**
 * Resolve which build to serve.
 *
 * If buildHash is provided (preview), use that directly.
 * Otherwise, fetch the current target from B3nd.
 */
export async function resolveTarget(
  client: B3ndReader,
  request: HostRequest,
  pattern: UriPattern = "accounts",
): Promise<BuildTarget> {
  const { appPubkey, buildHash } = request;

  if (buildHash) {
    // Preview mode - use specified build
    return {
      appPubkey,
      buildHash,
      baseUri: buildBaseUri(appPubkey, buildHash, pattern),
    };
  }

  // Fetch current target
  const uri = targetUri(appPubkey, pattern);
  const result = await client.read<TargetPointer | AuthenticatedMessage<TargetPointer>>(uri);

  if (!result.success || !result.record?.data) {
    throw new ResolveError(`No target found for app ${appPubkey}`, "NO_TARGET");
  }

  // Unwrap authenticated message
  const target = unwrapData(result.record.data);

  return {
    appPubkey,
    buildHash: target.buildHash,
    baseUri: buildBaseUri(appPubkey, target.buildHash, pattern),
    version: target.version,
  };
}

/**
 * Fetch the manifest for a build.
 */
export async function getManifest(
  client: B3ndReader,
  target: BuildTarget,
): Promise<Manifest> {
  const uri = `${target.baseUri}/manifest.json`;
  const result = await client.read<Manifest | AuthenticatedMessage<Manifest>>(uri);

  if (!result.success || !result.record?.data) {
    throw new ResolveError(
      `No manifest found for build ${target.buildHash}`,
      "NO_MANIFEST",
    );
  }

  // Unwrap authenticated message
  return unwrapData(result.record.data);
}

/**
 * Export unwrapData for use in handlers that read content.
 */
export { unwrapData };

/**
 * Resolve a request path to an actual file in the build.
 *
 * Handles:
 * - Direct file matches
 * - Directory index (path/ -> path/index.html)
 * - SPA fallback (unknown paths -> entrypoint)
 */
export function resolvePath(
  path: string,
  manifest: Manifest,
): ResolvedPath {
  // Normalize path
  let normalizedPath = path.startsWith("/") ? path.slice(1) : path;

  // Empty path -> entrypoint
  if (!normalizedPath) {
    normalizedPath = manifest.routing?.entrypoint ?? "index.html";
  }

  // Check for direct match
  if (manifest.files[normalizedPath]) {
    return {
      filePath: normalizedPath,
      file: manifest.files[normalizedPath],
    };
  }

  // Check for directory index
  const indexPath = normalizedPath.endsWith("/")
    ? `${normalizedPath}index.html`
    : `${normalizedPath}/index.html`;

  if (manifest.files[indexPath]) {
    return {
      filePath: indexPath,
      file: manifest.files[indexPath],
    };
  }

  // SPA fallback
  if (manifest.routing?.spa) {
    const entrypoint = manifest.routing.entrypoint ?? "index.html";
    if (manifest.files[entrypoint]) {
      return {
        filePath: entrypoint,
        file: manifest.files[entrypoint],
        fallback: true,
      };
    }
  }

  // Not found
  throw new ResolveError(`File not found: ${path}`, "NOT_FOUND");
}

/**
 * Build the full URI for a file in a build.
 */
export function fileUri(target: BuildTarget, filePath: string): string {
  return `${target.baseUri}/${filePath}`;
}

/**
 * Error during resolution.
 */
export class ResolveError extends Error {
  constructor(
    message: string,
    public code: "NO_TARGET" | "NO_MANIFEST" | "NOT_FOUND" | "INVALID_APP",
  ) {
    super(message);
    this.name = "ResolveError";
  }
}
