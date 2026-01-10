/**
 * Request Handler for public-static host.
 *
 * Handles the full request flow:
 * 1. Parse appPubkey and path from URL
 * 2. Resolve target build
 * 3. Fetch manifest
 * 4. Resolve file path
 * 5. Fetch and decrypt content
 * 6. Return response with headers
 */

import {
  buildErrorHeaders,
  buildResponseHeaders,
  decrypt,
  fileUri,
  getManifest,
  hexToBytes,
  isEncrypted,
  resolvePath,
  ResolveError,
  resolveTarget,
  type B3ndReader,
  type BuildTarget,
  type HostConfig,
  type HostInfoResponse,
  type Manifest,
} from "@appsfirecat/host-protocol";

/**
 * Simple in-memory cache for targets and manifests.
 */
interface Cache {
  targets: Map<string, { target: BuildTarget; expiresAt: number }>;
  manifests: Map<string, { manifest: Manifest; expiresAt: number }>;
}

/**
 * Create a request handler for the public-static host.
 */
export function createHandler(
  client: B3ndReader,
  config: HostConfig,
) {
  const cache: Cache = {
    targets: new Map(),
    manifests: new Map(),
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check
    if (path === "/_health") {
      return handleHealth(client, config);
    }

    // Host public key
    if (path === "/_pubkey") {
      return handlePubkey(config);
    }

    // Host info
    if (path === "/_info") {
      return handleInfo(config);
    }

    // Parse: /{appPubkey}/{path...}
    const match = path.match(/^\/([a-f0-9]{64})(\/.*)?$/i);
    if (!match) {
      return new Response("Invalid path. Expected: /{appPubkey}/{path}", {
        status: 400,
        headers: buildErrorHeaders(),
      });
    }

    const appPubkey = match[1];
    const filePath = match[2] ?? "/";

    // Check allowed apps
    if (config.allowedApps && !config.allowedApps.includes(appPubkey)) {
      return new Response("App not allowed on this host", {
        status: 403,
        headers: buildErrorHeaders(),
      });
    }

    // Handle preview mode via query param
    const buildHash = url.searchParams.get("build") ?? undefined;

    try {
      return await handleContent(
        client,
        config,
        cache,
        appPubkey,
        filePath,
        buildHash,
      );
    } catch (error) {
      return handleError(error);
    }
  };
}

/**
 * Handle content request.
 */
async function handleContent(
  client: B3ndReader,
  config: HostConfig,
  cache: Cache,
  appPubkey: string,
  path: string,
  buildHash?: string,
): Promise<Response> {
  // 1. Resolve target (with caching)
  const target = await getCachedTarget(client, cache, config, appPubkey, buildHash);

  // 2. Get manifest (with caching)
  const manifest = await getCachedManifest(client, cache, config, target);

  // 3. Resolve path
  const resolved = resolvePath(path, manifest);

  // 4. Fetch content from B3nd
  const contentUri = fileUri(target, resolved.filePath);
  const contentResult = await client.read<Uint8Array>(contentUri);

  if (!contentResult.success || !contentResult.record?.data) {
    throw new ResolveError(`Failed to fetch content: ${contentUri}`, "NOT_FOUND");
  }

  let content = contentResult.record.data;

  // Handle if data comes as base64 string (common in B3nd for binary)
  if (typeof content === "string") {
    content = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  }

  // 5. Decrypt if needed
  if (isEncrypted(manifest)) {
    content = await decrypt(content, {
      hostPrivateKey: config.hostPrivateKey,
      hostPubkey: config.hostPubkey,
      manifest,
    });
  }

  // 6. Build response headers
  const headers = buildResponseHeaders(
    resolved.filePath,
    resolved.file,
    manifest,
    { gzipped: resolved.file.gzipped },
  );

  // Add build info header (useful for debugging)
  headers.set("X-Build-Hash", target.buildHash.substring(0, 16));
  if (target.version) {
    headers.set("X-Build-Version", target.version);
  }
  if (resolved.fallback) {
    headers.set("X-Fallback", "true");
  }

  return new Response(content, { status: 200, headers });
}

/**
 * Get target with caching.
 */
async function getCachedTarget(
  client: B3ndReader,
  cache: Cache,
  config: HostConfig,
  appPubkey: string,
  buildHash?: string,
): Promise<BuildTarget> {
  // Preview mode bypasses cache
  if (buildHash) {
    return resolveTarget(client, { appPubkey, path: "/", buildHash });
  }

  const cacheKey = appPubkey;
  const cached = cache.targets.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.target;
  }

  const target = await resolveTarget(client, { appPubkey, path: "/" });

  cache.targets.set(cacheKey, {
    target,
    expiresAt: now + (config.targetCacheTtl ?? 5000),
  });

  return target;
}

/**
 * Get manifest with caching.
 */
async function getCachedManifest(
  client: B3ndReader,
  cache: Cache,
  config: HostConfig,
  target: BuildTarget,
): Promise<Manifest> {
  const cacheKey = `${target.appPubkey}:${target.buildHash}`;
  const cached = cache.manifests.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.manifest;
  }

  const manifest = await getManifest(client, target);

  cache.manifests.set(cacheKey, {
    manifest,
    expiresAt: now + (config.manifestCacheTtl ?? 60000),
  });

  return manifest;
}

/**
 * Handle health check.
 */
async function handleHealth(
  client: B3ndReader,
  config: HostConfig,
): Promise<Response> {
  let backendStatus: "ok" | "error" = "error";

  try {
    // Try to read schema or any lightweight operation
    const result = await client.read("mutable://open/health-check");
    backendStatus = result.success || result.error === "Not found" ? "ok" : "error";
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
    capabilities: ["decrypt", "preview"],
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
  if (error instanceof ResolveError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return new Response(error.message, {
      status,
      headers: buildErrorHeaders(),
    });
  }

  console.error("Unhandled error:", error);
  return new Response("Internal server error", {
    status: 500,
    headers: buildErrorHeaders(),
  });
}
