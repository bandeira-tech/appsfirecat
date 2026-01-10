# Apps Firecat

Decentralized static app hosting using B3nd/Firecat for content storage.

## Architecture

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
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       HOST PROTOCOL                             │
│  packages/host-protocol - shared types & utilities              │
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  public-static    │ │  shell-server     │ │  container-host   │
│  (Implemented)    │ │  (Future)         │ │  (Future)         │
└───────────────────┘ └───────────────────┘ └───────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DOMAIN/PROXY LAYER                           │
│  (Separate concern - Caddy, Nginx, Cloudflare, etc.)            │
└─────────────────────────────────────────────────────────────────┘
```

## Packages

### `packages/host-protocol`

Shared types and utilities for all host implementations:
- Type definitions (Manifest, BuildTarget, HostConfig, etc.)
- Target resolution logic
- Decryption utilities
- HTTP header generation

### `packages/public-static`

First host implementation. A minimal server that:
- Receives `/{appPubkey}/{path}` requests
- Resolves target build from B3nd
- Fetches and decrypts content
- Serves with appropriate cache headers

## Quick Start

### Run public-static in dev mode

```bash
# Generate random keypair and connect to testnet
deno run -A packages/public-static/mod.ts --dev
```

### Run with configuration

```bash
BACKEND_URL=https://testnet-evergreen.fire.cat \
HOST_PRIVATE_KEY=your-x25519-private-key-hex \
HOST_PUBKEY=your-x25519-public-key-hex \
PORT=8080 \
deno run -A packages/public-static/mod.ts
```

### Test endpoints

```bash
# Health check
curl http://localhost:8080/_health

# Get host public key
curl http://localhost:8080/_pubkey

# Get host info
curl http://localhost:8080/_info

# Serve content (once you have an app deployed)
curl http://localhost:8080/{appPubkey}/index.html
```

## Workflow Vision

```bash
# Developer workflow
btc init                    # Create app identity (Ed25519 keypair)
btc build                   # npm build → gzip files
btc encrypt --host apps.fire.cat   # Encrypt to host's public key
btc publish                 # Write to B3nd
btc deploy                  # Update target pointer

# Configure domain (proxy layer)
# Option A: Caddy/Nginx rewrites domain → /{appPubkey}/
# Option B: Cloudflare Worker maps domain → host
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - system design and data flow
- [Open Questions](docs/OPEN_QUESTIONS.md) - design questions being resolved
- [Explorations](docs/explorations/) - detailed analysis of design options

## Status

**Phase: Initial implementation**

- [x] Host protocol types and utilities
- [x] public-static server skeleton
- [ ] Full encryption/decryption flow
- [ ] CLI tools for build/encrypt/publish
- [ ] Integration tests
- [ ] Domain proxy examples
