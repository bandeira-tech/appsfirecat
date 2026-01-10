# Apps Host Architecture

A Deno server using B3nd/Firecat that works as a multi-tenant static app host, optimized for frontend-first applications.

## Vision

Enable a deployment workflow where:
1. User develops application (manually or with agent)
2. User builds their application frontend
3. User writes build as version content to B3nd
4. User writes target version pointer to B3nd
5. User configures DNS to point domain to host

The host server reads from B3nd and serves content - anyone can run their own host server to serve their own content.

## Core Principles

### B3nd-First Interaction

The host server should have **minimal HTTP API**. Instead:
- Users interact with B3nd directly for content management
- CLI tools orchestrate B3nd actions, not HTTP calls to the host
- Host server reads from B3nd and serves - that's its primary job
- HTTP API only for things that **must** be host-specific (e.g., domain verification challenges)

### External Caching

The host server:
- Controls caching via HTTP headers only
- Does NOT implement caching layer itself
- Expects external CDN/cache (Cloudflare, Varnish, Fastly, etc.)
- Focuses on being a correct origin server

### Decentralized by Design

- No central network or token economics
- Anyone can run a host server
- Content lives on B3nd (Firecat or self-hosted)
- Host servers are stateless readers of B3nd data

## URI Schema

### Build Content (Immutable)

```
immutable://accounts/{appPubkey}/builds/{buildHash}/
├── manifest.json          # File listing with hashes
├── index.html
├── assets/
│   ├── main.{hash}.js
│   ├── main.{hash}.css
│   └── images/
│       └── logo.png
└── ...
```

Each file stored individually for:
- Partial caching (unchanged files stay cached)
- Range requests support
- Parallel fetching
- Content-addressable per-file integrity

### Build Manifest

```json
{
  "version": "1.0.0",
  "buildHash": "abc123...",
  "createdAt": 1704067200000,
  "files": {
    "index.html": {
      "size": 1234,
      "hash": "sha256:...",
      "contentType": "text/html",
      "encoding": "gzip"
    },
    "assets/main.abc123.js": {
      "size": 45678,
      "hash": "sha256:...",
      "contentType": "application/javascript",
      "encoding": "gzip"
    }
  },
  "entrypoint": "index.html",
  "spa": true,
  "headers": {
    "assets/*": {
      "Cache-Control": "public, max-age=31536000, immutable"
    },
    "index.html": {
      "Cache-Control": "public, max-age=0, must-revalidate"
    }
  }
}
```

### Version Target (Mutable Pointer)

```
mutable://accounts/{appPubkey}/target
```

```json
{
  "buildHash": "abc123...",
  "version": "1.0.0",
  "updatedAt": 1704067200000,
  "updatedBy": "pubkey of deployer"
}
```

### App Configuration

```
mutable://accounts/{appPubkey}/config
```

```json
{
  "domains": ["myapp.com", "www.myapp.com"],
  "spa": true,
  "defaultHeaders": {},
  "encryption": {
    "enabled": true,
    "publicKey": "x25519 public key for host"
  }
}
```

## Request Flow

```
Request: https://myapp.com/dashboard
         ↓
   ┌──────────────┐
   │  CDN/Cache   │ ← Cache HIT? Serve directly
   └──────┬───────┘
          │ Cache MISS
          ↓
   ┌──────────────┐
   │  Host Server │
   └──────┬───────┘
          │
   1. Resolve domain → appPubkey
          │ (via DNS TXT or local mapping)
          ↓
   2. Fetch mutable://accounts/{appPubkey}/target
          │ → { buildHash: "abc123..." }
          ↓
   3. Fetch immutable://accounts/{appPubkey}/builds/abc123.../manifest.json
          │ → file listing, SPA config
          ↓
   4. Resolve path: /dashboard
          │ SPA mode? → /index.html
          ↓
   5. Fetch immutable://accounts/{appPubkey}/builds/abc123.../index.html
          │ → content (possibly encrypted)
          ↓
   6. Decrypt if needed (using shared key)
          ↓
   7. Serve with appropriate headers
          │ (Cache-Control, ETag, Content-Type)
          ↓
   Response to CDN (caches) → Client
```

## Encryption Model

For apps requiring access control, content is encrypted client-side before upload.

### Public Content (Default)
- No encryption
- Anyone with the URL can access
- Standard CDN caching works

### Protected Content
- Content encrypted with key derived from password
- Host cannot decrypt without password
- User accesses site → auth flow → gets decryption key
- Two options for serving:
  1. **Client-side decryption:** Host serves encrypted, JS decrypts
  2. **Host-assisted decryption:** App shares key with host for specific sessions

### Private Content
- Content encrypted to app owner's key
- Only owner can decrypt
- Useful for staging/preview environments

### Host Key Sharing (for Protected Content)

When an app needs the host to serve decrypted content:

```
mutable://accounts/{appPubkey}/host-keys/{hostPubkey}
```

```json
{
  "encryptedContentKey": "...",  // Content key encrypted to host's pubkey
  "grantedAt": 1704067200000,
  "expiresAt": 1704153600000,    // Optional expiry
  "paths": ["/*"]                // Which paths this key covers
}
```

This allows:
- App owner controls which hosts can decrypt
- Time-limited access grants
- Path-specific access
- Revocation by deleting the grant

## Domain Management

### Verification via DNS TXT

```
_b3nd.myapp.com TXT "app=052fee...abc123"
```

Host server:
1. Receives request for `myapp.com`
2. DNS lookup `_b3nd.myapp.com` TXT
3. Extracts `appPubkey` from record
4. Fetches content from B3nd using that pubkey

### Local Domain Mapping (Development/Self-Hosted)

For development or when running your own host:

```
mutable://accounts/{hostPubkey}/domain-mappings/{domain}
```

```json
{
  "appPubkey": "052fee...",
  "addedAt": 1704067200000,
  "verified": true
}
```

## CLI Workflow (btc evolution)

```bash
# Initialize app identity
btc init
# → Creates .btc/keys.json with appPubkey/privateKey
# → Writes initial config to mutable://accounts/{appPubkey}/config

# Build and publish
btc build
# → Runs npm build (or configured build command)
# → Gzips files individually
# → Generates manifest.json
# → Writes to immutable://accounts/{appPubkey}/builds/{hash}/

# Deploy (update target pointer)
btc deploy
# → Updates mutable://accounts/{appPubkey}/target → latest build

# Or combined
btc ship
# → build + deploy

# Domain management
btc domains add myapp.com
# → Updates config.domains
# → Shows DNS TXT record to add

btc domains verify myapp.com
# → Checks DNS TXT record matches appPubkey

# Rollback
btc rollback v1.0.0
# → Updates target to point to previous buildHash

# List builds
btc builds
# → Lists immutable://accounts/{appPubkey}/builds/
```

## Host Server Implementation

Minimal Deno server responsibilities:
1. DNS resolution (domain → appPubkey)
2. B3nd reads (target, manifest, content)
3. Decryption (when key is shared)
4. HTTP response formatting (headers, compression)

**Not responsible for:**
- Caching (external CDN)
- SSL termination (reverse proxy/CDN)
- Rate limiting (external)
- Analytics (external or B3nd-based)
