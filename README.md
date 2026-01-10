# Apps Firecat

A decentralized static app host using B3nd/Firecat for content storage.

## Concept

Host frontend applications where:
- **Content lives on B3nd** - builds stored as immutable content, version pointers as mutable
- **Host servers are stateless readers** - anyone can run a host, reads from B3nd, serves HTTP
- **External caching** - hosts set headers, CDN/Varnish handles caching
- **B3nd-first workflow** - CLI orchestrates B3nd writes, minimal host HTTP API

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md) - system design and data flow
- [Open Questions](docs/OPEN_QUESTIONS.md) - design questions to resolve
- [Decision Records](docs/decisions/README.md) - resolved decisions

## Workflow Vision

```bash
# Developer builds and publishes
btc init                    # Create app identity (Ed25519 keypair)
btc build                   # npm build → gzip files → write to B3nd
btc deploy                  # Update target pointer in B3nd

# Configure DNS
# _b3nd.myapp.com TXT "app=052fee..."
# myapp.com CNAME apps.fire.cat

btc domains verify myapp.com  # Verify DNS configuration

# Site is live at myapp.com
```

## Status

**Phase: Design exploration**

Currently defining architecture and resolving open questions before implementation.
