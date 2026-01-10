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
 * Build the base URI for a build.
 */
export function buildBaseUri(appPubkey: string, buildHash: string): string {
  return `immutable://accounts/${appPubkey}/builds/${buildHash}`;
}

/**
 * Build the target URI for an app.
 */
export function targetUri(appPubkey: string): string {
  return `mutable://accounts/${appPubkey}/target`;
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
): Promise<BuildTarget> {
  const { appPubkey, buildHash } = request;

  if (buildHash) {
    // Preview mode - use specified build
    return {
      appPubkey,
      buildHash,
      baseUri: buildBaseUri(appPubkey, buildHash),
    };
  }

  // Fetch current target
  const uri = targetUri(appPubkey);
  const result = await client.read<TargetPointer>(uri);

  if (!result.success || !result.record?.data) {
    throw new ResolveError(`No target found for app ${appPubkey}`, "NO_TARGET");
  }

  const target = result.record.data;

  return {
    appPubkey,
    buildHash: target.buildHash,
    baseUri: buildBaseUri(appPubkey, target.buildHash),
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
  const result = await client.read<Manifest>(uri);

  if (!result.success || !result.record?.data) {
    throw new ResolveError(
      `No manifest found for build ${target.buildHash}`,
      "NO_MANIFEST",
    );
  }

  return result.record.data;
}

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
