/**
 * Tests for the public-static host handler.
 *
 * Tests cover:
 * - System endpoints (/api/v1/health, /api/v1/pubkey, /api/v1/info, /api/v1/target)
 * - Content serving via /api/v1/serve/* with correct content-type
 * - Directory index fallback
 * - Target resolution (direct path vs mutable pointer)
 * - Link following
 * - Service provider flow
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createHandler } from "../src/handler.ts";
import type { B3ndReader, HostConfig, ReadResult } from "../../host-protocol/mod.ts";

/**
 * Mock B3nd client for testing.
 */
class MockB3ndClient implements B3ndReader {
  private data: Map<string, unknown> = new Map();

  set(uri: string, value: unknown): void {
    this.data.set(uri, value);
  }

  async read<T>(uri: string): Promise<ReadResult<T>> {
    const value = this.data.get(uri);
    if (value === undefined) {
      return { success: false, error: "Not found" };
    }
    return {
      success: true,
      record: {
        uri,
        data: value as T,
        timestamp: Date.now(),
      },
    };
  }
}

/**
 * Create a test config.
 */
function createTestConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  return {
    backendUrl: "https://test.example.com",
    hostPubkey: "abc123pubkey",
    hostPrivateKey: "abc123privatekey",
    port: 8080,
    ...overrides,
  };
}

/**
 * Create a request for testing.
 * Sets Host header explicitly since Deno's Request constructor doesn't auto-populate it.
 */
function createRequest(path: string): Request {
  return new Request(`http://localhost:8080${path}`, {
    headers: { "host": "localhost:8080" },
  });
}

// =============================================================================
// System Endpoints
// =============================================================================

Deno.test("/api/v1/health returns health status - degraded when backend unavailable", async () => {
  const client = new MockB3ndClient();
  // No health endpoint in mock, so backend check fails
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/health"));
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.status, "degraded");
  assertEquals(body.backend.url, "https://test.example.com");
  assertEquals(body.backend.status, "error");
});

Deno.test("/api/v1/health response format includes backend info", async () => {
  const client = new MockB3ndClient();
  // Health check uses HTTP fetch to backend, which can't be mocked here.
  // This test verifies the response format structure.
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/health"));
  const body = await response.json();

  // Verify response structure (status will be degraded since fetch fails in tests)
  assertEquals(typeof body.status, "string");
  assertEquals(typeof body.timestamp, "number");
  assertEquals(typeof body.backend, "object");
  assertEquals(body.backend.url, "https://test.example.com");
  assertEquals(typeof body.backend.status, "string");
});

Deno.test("/api/v1/pubkey returns host public key", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/pubkey"));
  const body = await response.text();

  assertEquals(response.status, 200);
  assertEquals(body, "abc123pubkey");
});

Deno.test("/api/v1/info returns host info with target", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/info"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.pubkey, "abc123pubkey");
  assertEquals(body.type, "public-static");
  assertEquals(body.target, "immutable://test/site/");
});

Deno.test("/api/v1/target returns configured target", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/target"));
  const body = await response.text();

  assertEquals(response.status, 200);
  assertEquals(body, "immutable://test/site/");
});

Deno.test("/api/v1/target returns 404 when no target configured", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: undefined });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/target"));

  assertEquals(response.status, 404);
});

// =============================================================================
// Content Serving via /api/v1/serve/*
// =============================================================================

Deno.test("serves HTML with correct content-type", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/index.html", "<!DOCTYPE html><html></html>");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
  assertEquals(await response.text(), "<!DOCTYPE html><html></html>");
});

Deno.test("serves CSS with correct content-type", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/styles.css", "body { color: red; }");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/styles.css"));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/css; charset=utf-8");
});

Deno.test("serves JavaScript with correct content-type", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/app.js", "console.log('hello');");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/app.js"));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/javascript; charset=utf-8");
});

Deno.test("serves JSON with correct content-type", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/data.json", { key: "value" });

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/data.json"));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/json; charset=utf-8");
});

Deno.test("serves nested paths correctly", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/assets/css/main.css", ".main { display: flex; }");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/assets/css/main.css"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), ".main { display: flex; }");
});

Deno.test("returns 404 for non-existent files", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/notfound.html"));

  assertEquals(response.status, 404);
});

// =============================================================================
// Directory Index Fallback
// =============================================================================

Deno.test("serves index.html for root path /", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/index.html", "<html>Home</html>");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Home</html>");
});

Deno.test("serves index.html for directory path with trailing slash", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/docs/index.html", "<html>Docs</html>");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/docs/"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Docs</html>");
});

Deno.test("serves index.html for directory path without trailing slash", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/docs/index.html", "<html>Docs</html>");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/docs"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Docs</html>");
});

// =============================================================================
// Target Resolution
// =============================================================================

Deno.test("uses direct immutable target ending with /", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://accounts/abc/site/index.html", "<html>Direct</html>");

  const config = createTestConfig({ target: "immutable://accounts/abc/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Direct</html>");
});

Deno.test("resolves mutable pointer target (not ending with /)", async () => {
  const client = new MockB3ndClient();
  // The pointer contains a URI string
  client.set("mutable://accounts/abc/target", "immutable://accounts/abc/site/");
  client.set("immutable://accounts/abc/site/index.html", "<html>Resolved</html>");

  const config = createTestConfig({ target: "mutable://accounts/abc/target" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Resolved</html>");
});

Deno.test("uses mutable target directly if ending with /", async () => {
  const client = new MockB3ndClient();
  client.set("mutable://accounts/abc/site/index.html", "<html>Mutable Direct</html>");

  const config = createTestConfig({ target: "mutable://accounts/abc/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Mutable Direct</html>");
});

Deno.test("returns 503 when no target configured", async () => {
  const client = new MockB3ndClient();
  const config = createTestConfig({ target: undefined });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 503);
  assertStringIncludes(await response.text(), "No target configured");
});

// =============================================================================
// Link Protocol Following
// =============================================================================
// Note: Only link:// protocol URIs are followed automatically.
// mutable:// and immutable:// URIs serve content directly.

Deno.test("follows link:// protocol", async () => {
  const client = new MockB3ndClient();
  // link:// protocol with direct file mapping - typical deploy pattern
  // Each file has its own link pointing to immutable content
  client.set("link://test/site/index.html", "immutable://other/content");
  client.set("immutable://other/content", "<html>Linked</html>");

  const config = createTestConfig({ target: "link://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Linked</html>");
});

Deno.test("follows link with blob target", async () => {
  const client = new MockB3ndClient();
  // link -> blob (typical deploy pattern)
  client.set("link://accounts/abc/mysite/v1/index.html", "blob://open/sha256:abc123");
  client.set("blob://open/sha256:abc123", "<html>From Blob</html>");

  const config = createTestConfig({ target: "link://accounts/abc/mysite/v1/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>From Blob</html>");
});

Deno.test("follows chained links", async () => {
  const client = new MockB3ndClient();
  // link -> link -> blob
  client.set("link://test/site/link1", "link://test/site/link2");
  client.set("link://test/site/link2", "blob://open/sha256:final");
  client.set("blob://open/sha256:final", "<html>Final</html>");

  const config = createTestConfig({ target: "link://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/link1"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Final</html>");
});

Deno.test("stops at max link depth to prevent infinite loops", async () => {
  const client = new MockB3ndClient();
  // Create a link loop (links pointing to each other)
  for (let i = 1; i <= 15; i++) {
    client.set(`link://test/site/loop${i}`, `link://test/site/loop${i + 1}`);
  }
  client.set("link://test/site/loop16", "link://test/site/loop1"); // Loop back

  const config = createTestConfig({ target: "link://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/loop1"));

  assertEquals(response.status, 508); // Loop Detected
  assertStringIncludes(await response.text(), "Too many link redirects");
});

Deno.test("does not follow immutable:// values as links", async () => {
  const client = new MockB3ndClient();
  // immutable:// stores a string that looks like a URI - should NOT follow it
  client.set("immutable://test/site/pointer.txt", "immutable://other/site/");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/pointer.txt"));

  // Should serve the string directly, not follow it
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "immutable://other/site/");
});

Deno.test("does not follow mutable:// values as links", async () => {
  const client = new MockB3ndClient();
  // mutable:// stores a string - should NOT follow it
  client.set("mutable://test/config", "immutable://some/content/");

  const config = createTestConfig({ target: "mutable://test/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/config"));

  // Should serve the string directly
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "immutable://some/content/");
});

// =============================================================================
// Service Provider Flow
// =============================================================================

Deno.test("service provider flow: host multiple users", async () => {
  const client = new MockB3ndClient();

  // Provider hosts using link:// protocol with direct file mappings
  // Each hosted file has a link pointing to the user's content
  client.set("link://accounts/provider/hosted/alice/index.html", "blob://sha256:alice-index");
  client.set("link://accounts/provider/hosted/alice/styles.css", "blob://sha256:alice-styles");
  client.set("link://accounts/provider/hosted/bob/index.html", "blob://sha256:bob-index");
  client.set("link://accounts/provider/hosted/bob/app.js", "blob://sha256:bob-app");

  // Content blobs
  client.set("blob://sha256:alice-index", "<html>Alice's Site</html>");
  client.set("blob://sha256:alice-styles", ".alice { color: pink; }");
  client.set("blob://sha256:bob-index", "<html>Bob's Site</html>");
  client.set("blob://sha256:bob-app", "console.log('bob');");

  const config = createTestConfig({ target: "link://accounts/provider/hosted/" });
  const handler = createHandler(client, config);

  // Access Alice's site
  const aliceHome = await handler(createRequest("/api/v1/serve/alice/"));
  assertEquals(aliceHome.status, 200);
  assertEquals(await aliceHome.text(), "<html>Alice's Site</html>");

  const aliceStyles = await handler(createRequest("/api/v1/serve/alice/styles.css"));
  assertEquals(aliceStyles.status, 200);
  assertEquals(await aliceStyles.text(), ".alice { color: pink; }");

  // Access Bob's site
  const bobHome = await handler(createRequest("/api/v1/serve/bob/"));
  assertEquals(bobHome.status, 200);
  assertEquals(await bobHome.text(), "<html>Bob's Site</html>");

  const bobApp = await handler(createRequest("/api/v1/serve/bob/app.js"));
  assertEquals(bobApp.status, 200);
  assertEquals(await bobApp.text(), "console.log('bob');");
});

Deno.test("service provider flow: 404 for non-hosted user", async () => {
  const client = new MockB3ndClient();

  // Provider only hosts alice
  client.set("link://accounts/provider/hosted/alice/index.html", "blob://sha256:alice");
  client.set("blob://sha256:alice", "<html>Alice's Site</html>");

  const config = createTestConfig({ target: "link://accounts/provider/hosted/" });
  const handler = createHandler(client, config);

  // Try to access non-hosted user
  const response = await handler(createRequest("/api/v1/serve/charlie/index.html"));

  assertEquals(response.status, 404);
});

// =============================================================================
// Authenticated Message Unwrapping
// =============================================================================

Deno.test("unwraps authenticated message format", async () => {
  const client = new MockB3ndClient();
  // Simulates data wrapped in B3nd auth format
  client.set("immutable://test/site/index.html", {
    auth: [{ pubkey: "abc123", signature: "sig123" }],
    payload: "<html>Authenticated</html>",
  });

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>Authenticated</html>");
});

Deno.test("unwraps nested authenticated link", async () => {
  const client = new MockB3ndClient();
  // Link:// protocol with auth-wrapped target
  client.set("link://provider/hosted/user1/index.html", {
    auth: [{ pubkey: "provider", signature: "sig" }],
    payload: "blob://sha256:user1-index",
  });
  client.set("blob://sha256:user1-index", {
    auth: [{ pubkey: "user1", signature: "sig" }],
    payload: "<html>User Content</html>",
  });

  const config = createTestConfig({ target: "link://provider/hosted/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/user1/"));

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<html>User Content</html>");
});

// =============================================================================
// Cache Headers
// =============================================================================

Deno.test("sets standard cache for non-hashed content", async () => {
  const client = new MockB3ndClient();
  // Cache is now path-based, not protocol-based
  // Non-hashed files get 1 hour cache regardless of protocol
  client.set("mutable://test/site/index.html", "<html>Mutable</html>");

  const config = createTestConfig({ target: "mutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.headers.get("cache-control"), "public, max-age=3600");
});

Deno.test("sets longer cache for immutable content", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/index.html", "<html>Immutable</html>");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/index.html"));

  assertEquals(response.headers.get("cache-control"), "public, max-age=3600");
});

Deno.test("sets immutable cache for hashed assets", async () => {
  const client = new MockB3ndClient();
  client.set("immutable://test/site/main.a1b2c3d4.js", "// hashed asset");

  const config = createTestConfig({ target: "immutable://test/site/" });
  const handler = createHandler(client, config);

  const response = await handler(createRequest("/api/v1/serve/main.a1b2c3d4.js"));

  assertEquals(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
});
