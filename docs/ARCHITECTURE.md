# Apps Host Architecture

## Overview

The Apps Host system follows B3nd's pattern of separating **protocol** from **implementation**.

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER WORKFLOW                           │
│  Developer → Build → Encrypt → Write to B3nd → Point to Host   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      B3ND CONTENT LAYER                         │
│  immutable://accounts/{appPubkey}/builds/{hash}/...             │
│  mutable://accounts/{appPubkey}/target                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       HOST PROTOCOL                             │
│  Contract: How hosts read from B3nd and serve HTTP              │
│  - Target resolution                                            │
│  - Content fetching                                             │
│  - Decryption (when keys available)                             │
│  - HTTP response formatting                                     │
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  public-static    │ │  shell-server     │ │  container-host   │
│  (First impl)     │ │  (Future)         │ │  (Future)         │
└───────────────────┘ └───────────────────┘ └───────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DOMAIN/PROXY LAYER                           │
│  (Separate concern - Caddy, Nginx, Cloudflare, etc.)            │
│  Maps domains → host instances                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Separation

### Layer 1: B3nd Content (Already Exists)

Where builds live. Users write here directly via CLI or SDK.

```
immutable://accounts/{appPubkey}/builds/{buildHash}/
├── manifest.json
├── index.html
├── assets/
│   └── main.abc123.js
└── ...

mutable://accounts/{appPubkey}/target
→ { buildHash: "...", version: "..." }
```

### Layer 2: Host Protocol (This Project)

The contract that all host implementations follow. Defines:
- How to resolve which build to serve
- How to read content from B3nd
- How to handle encryption/decryption
- How to format HTTP responses

### Layer 3: Host Implementations

Different servers for different needs. Each is small and focused.

| Implementation | Purpose | Trust Model |
|----------------|---------|-------------|
| `public-static` | Serve encrypted content, decrypt with host key | Trust host |
| `shell-server` | Serve shell + encrypted bytes | Trust client |
| `container-host` | Run as container image | Self-hosted |
| `edge-worker` | Cloudflare/Deno Deploy worker | Edge CDN |

### Layer 4: Domain/Proxy Layer (Separate Concern)

Domain mapping, TLS, routing. Handled by:
- Reverse proxy (Caddy, Nginx, Traefik)
- CDN (Cloudflare, Fastly)
- DNS configuration

This layer is **not part of the host implementations**. Hosts just serve content for a given appPubkey. The proxy layer maps domains to hosts.

---

## Host Protocol Specification

### Inputs

A host implementation receives:

```typescript
interface HostRequest {
  appPubkey: string;      // Which app to serve
  path: string;           // Requested path (e.g., "/index.html")
  buildHash?: string;     // Optional: specific build (for previews)
}
```

### Resolution Flow

```typescript
interface HostProtocol {
  // 1. Resolve which build to serve
  resolveTarget(appPubkey: string, buildHash?: string): Promise<BuildTarget>;

  // 2. Read manifest
  getManifest(target: BuildTarget): Promise<Manifest>;

  // 3. Resolve path (SPA handling, etc.)
  resolvePath(path: string, manifest: Manifest): string;

  // 4. Read content
  readContent(target: BuildTarget, path: string): Promise<Uint8Array>;

  // 5. Decrypt if needed
  decrypt(content: Uint8Array, context: DecryptContext): Promise<Uint8Array>;

  // 6. Format response
  formatResponse(content: Uint8Array, path: string, manifest: Manifest): Response;
}
```

### Build Target

```typescript
interface BuildTarget {
  appPubkey: string;
  buildHash: string;
  baseUri: string;  // immutable://accounts/{appPubkey}/builds/{buildHash}
}
```

### Manifest Schema

```typescript
interface Manifest {
  version: string;
  buildHash: string;
  createdAt: number;

  // File listing
  files: Record<string, FileEntry>;

  // Routing
  spa?: boolean;
  entrypoint?: string;  // default: "index.html"

  // Encryption
  encryption?: {
    enabled: boolean;
    hostKeyUri?: string;  // Where wrapped key is stored
  };

  // Cache headers
  headers?: Record<string, HeaderConfig>;
}

interface FileEntry {
  size: number;
  contentType: string;
  hash?: string;
  encrypted?: boolean;
}
```

---

## First Implementation: public-static

A minimal server that:
1. Receives appPubkey + path
2. Resolves target from B3nd
3. Fetches content from B3nd
4. Decrypts using host's private key
5. Serves with appropriate headers

### Characteristics

- **Single responsibility:** Serve files for one or more appPubkeys
- **Stateless:** All state lives in B3nd
- **Has keypair:** Host has X25519 keypair for decryption
- **No domain logic:** Doesn't know about domains, just appPubkeys
- **No auth logic:** If it can decrypt, it serves (auth is proxy layer's job)

### Configuration

```typescript
interface PublicStaticConfig {
  // B3nd backend
  backendUrl: string;  // e.g., "https://testnet-evergreen.fire.cat"

  // Host identity
  hostPrivateKey: string;  // X25519 private key (hex)
  hostPublicKey: string;   // X25519 public key (hex)

  // Server
  port: number;

  // Optional: allowed apps (empty = any)
  allowedApps?: string[];
}
```

### API

```
GET /{appPubkey}/{path}
GET /{appPubkey}/                    → serves entrypoint
GET /{appPubkey}/_target             → returns current target info
GET /_health                         → health check
GET /_pubkey                         → returns host's public key
```

### Request Flow

```
GET /052fee.../index.html
         │
         ▼
┌─────────────────────────────────────┐
│ 1. Parse: appPubkey = 052fee...    │
│           path = index.html         │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 2. Fetch target from B3nd           │
│    mutable://accounts/052fee.../    │
│    target → { buildHash: "abc..." } │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 3. Fetch manifest                   │
│    immutable://accounts/052fee.../  │
│    builds/abc.../manifest.json      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 4. Resolve path                     │
│    SPA? 404 fallback to entrypoint  │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 5. Fetch content                    │
│    immutable://accounts/052fee.../  │
│    builds/abc.../index.html         │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 6. Decrypt (if encrypted)           │
│    Read wrapped key from manifest   │
│    Unwrap with host private key     │
│    Decrypt content                  │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 7. Serve response                   │
│    Content-Type from manifest       │
│    Cache headers from manifest      │
└─────────────────────────────────────┘
```

---

## Domain Mapping (Separate Layer)

The proxy layer maps domains to `{hostUrl}/{appPubkey}`.

### Option A: Caddy/Nginx Config

```caddy
myapp.com {
    reverse_proxy localhost:8080 {
        header_up X-App-Pubkey "052fee..."
    }
    rewrite * /052fee...{uri}
}
```

### Option B: Cloudflare Worker

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const appPubkey = DOMAIN_MAP[url.hostname];
    const hostUrl = `https://host.example.com/${appPubkey}${url.pathname}`;
    return fetch(hostUrl);
  }
}
```

### Option C: Dedicated Proxy Service (Future)

A service that:
- Reads domain mappings from B3nd
- Routes to appropriate host
- Handles TLS via Let's Encrypt

This is a **separate project**, not part of the host implementations.

---

## Repository Structure

```
appsfirecat/
├── packages/
│   ├── host-protocol/          # Shared protocol types & utilities
│   │   ├── src/
│   │   │   ├── types.ts        # Manifest, BuildTarget, etc.
│   │   │   ├── resolve.ts      # Target resolution logic
│   │   │   ├── decrypt.ts      # Decryption utilities
│   │   │   └── headers.ts      # Cache header logic
│   │   └── mod.ts
│   │
│   ├── public-static/          # First host implementation
│   │   ├── src/
│   │   │   ├── server.ts       # Hono server
│   │   │   ├── handler.ts      # Request handler
│   │   │   └── config.ts       # Configuration
│   │   ├── mod.ts
│   │   └── Dockerfile
│   │
│   ├── shell-server/           # Future: shell-based host
│   │
│   └── cli/                    # btc CLI extensions
│       └── commands/
│           ├── encrypt.ts      # Encrypt build to host key
│           └── publish.ts      # Write build to B3nd
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── OPEN_QUESTIONS.md
│   └── explorations/
│
└── deno.json                   # Workspace config
```

---

## Encryption Model

### At Build Time (CLI)

```typescript
// 1. Get host's public key
const hostPubkey = await fetch("https://host.example.com/_pubkey").then(r => r.text());

// 2. Generate content key for this build
const contentKey = await crypto.getRandomValues(new Uint8Array(32));

// 3. Encrypt each file with content key (symmetric, fast)
for (const file of files) {
  const encrypted = await encryptAesGcm(file.content, contentKey);
  await b3nd.write(`immutable://.../${file.path}`, encrypted);
}

// 4. Wrap content key to host's public key (asymmetric)
const wrappedKey = await encryptX25519(contentKey, hostPubkey);

// 5. Store wrapped key in manifest
manifest.encryption = {
  enabled: true,
  wrappedKey: wrappedKey,  // Or store at separate URI
};
```

### At Serve Time (Host)

```typescript
// 1. Read manifest
const manifest = await b3nd.read(`${baseUri}/manifest.json`);

// 2. Unwrap content key
const wrappedKey = manifest.encryption.wrappedKey;
const contentKey = await decryptX25519(wrappedKey, HOST_PRIVATE_KEY);

// 3. Read encrypted content
const encrypted = await b3nd.read(`${baseUri}/${path}`);

// 4. Decrypt with content key
const decrypted = await decryptAesGcm(encrypted, contentKey);

// 5. Serve
return new Response(decrypted, { headers });
```

---

## Unencrypted Content

Not all content needs encryption. For public sites:

```typescript
manifest.encryption = {
  enabled: false
};
```

Host serves directly without decryption step.

---

## Multi-Host Support

Apps can encrypt to multiple hosts:

```typescript
manifest.encryption = {
  enabled: true,
  keys: {
    "host-a-pubkey": "wrapped-key-for-a",
    "host-b-pubkey": "wrapped-key-for-b"
  }
};
```

Each host unwraps with its own private key.

---

## Future Implementations

### shell-server

For E2E encrypted apps where host shouldn't decrypt:
- Serves shell + encrypted bytes
- No host private key needed
- Client decrypts in browser

### container-host

Packaged as Docker image:
- Self-contained
- Easy deployment
- Includes host keypair management

### edge-worker

Runs on edge platforms:
- Cloudflare Workers
- Deno Deploy
- Minimal cold start
