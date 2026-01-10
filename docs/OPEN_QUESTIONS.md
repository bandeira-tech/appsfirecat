# Open Questions

Track design questions that need resolution. Each question should be explored, discussed, and resolved before implementation.

## Status Legend
- `[ ]` Open - needs exploration
- `[~]` In Progress - actively discussing
- `[x]` Resolved - decision made (see decision record)
- `[n/a]` Out of scope - clarified as not needed

---

## Established Design Principles

These have been clarified and guide the design:

1. **No custom network** - This is software anyone can run. No token economics, no network registration, no monetization layer. Just a server that reads B3nd and serves HTTP.

2. **B3nd-first interaction** - Users interact with B3nd directly for content management. The host server's HTTP API is minimal - only for things that MUST be host-specific. CLI orchestrates B3nd writes, not host API calls.

3. **External caching** - Host controls caching via HTTP headers only. Host does NOT implement caching. External CDN/cache (Cloudflare, Varnish, Fastly) handles caching. Host is a correct origin server.

4. **Stateless host** - Host servers are stateless readers of B3nd data. No local database, no persistent state beyond configuration.

5. **Encrypted content support** - Content can be encrypted for access control. When apps need host to decrypt, they share keys via B3nd grants.

---

## Build & Content Structure

### Q1: Build Storage Format
`[~]` **Should builds use manifest + individual files or single tarball?**

**Exploration:** [Q1-build-storage-format.md](explorations/Q1-build-storage-format.md)

**Context:** Need to decide the exact storage format for build content in B3nd.

**Options:**
- **A) Manifest + Individual Files** (proposed in ARCHITECTURE.md)
  - Each file stored at `immutable://.../{buildHash}/{path}`
  - Manifest lists all files with hashes/metadata
  - Pros: Partial caching, range requests, parallel fetch, per-file integrity
  - Cons: Many B3nd writes per build, manifest management complexity

- **B) Single Gzipped Tarball**
  - Entire build as one blob at `immutable://.../{buildHash}`
  - Pros: Simple write, atomic, single fetch
  - Cons: No partial caching, must fetch entire build for any file

- **C) Hybrid - Tarball with Index**
  - Tarball stored as blob
  - Separate index for byte-range offsets
  - Pros: Single write, range request possible
  - Cons: Complex implementation, non-standard

**Implications to explore:**
- B3nd write performance for many small files vs one large file
- CDN caching behavior with individual files
- Build time impact
- Rollback/diff capabilities

**Decision:** _TBD_

---

### Q2: Manifest Schema Details
`[ ]` **What exactly should the manifest contain?**

**Context:** The manifest is the source of truth for a build.

**To define:**
- Required vs optional fields
- SPA routing configuration format
- Custom headers specification
- Redirect rules format
- Error page configuration
- Asset versioning conventions

**Decision:** _TBD_

---

## Encryption & Access Control

### Q3: Encrypted Content Flow
`[~]` **How should protected content be served?**

**Explorations:**
- [Q3-encrypted-content-flow.md](explorations/Q3-encrypted-content-flow.md) - Initial analysis
- [Q3-extended-serving-models.md](explorations/Q3-extended-serving-models.md) - Extended: serving models, scenarios, host key model

**Context:** Apps may have content that requires authentication before viewing.

**Scenarios:**
1. **Public marketing site + Private dashboard**
   - `/` - public, unencrypted
   - `/app/*` - requires login, encrypted

2. **Entirely private site**
   - All content encrypted
   - Landing page is just login form (in build, unencrypted)

3. **Password-protected preview**
   - Entire site behind a password
   - No user accounts, just a shared secret

**Options for serving encrypted content:**

- **A) Client-side decryption**
  - Host serves encrypted bytes
  - JavaScript in browser decrypts
  - Pros: Host never sees plaintext, simpler host
  - Cons: JS overhead, can't cache decrypted, SEO issues

- **B) Host-assisted decryption**
  - App shares decryption key with host
  - Host decrypts on-the-fly
  - Pros: Normal HTTP caching, no JS overhead
  - Cons: Host sees plaintext, trust required

- **C) Hybrid by path**
  - Public paths: unencrypted, normal serving
  - Private paths: client-side decryption
  - Pros: Best of both for mixed sites
  - Cons: Complex configuration

**Key questions:**
- How does app share key with host securely?
- How is key revocation handled?
- Session/token management for decryption rights?

**Decision:** _TBD_

---

### Q4: Host Key Trust Model
`[ ]` **How do apps trust hosts with decryption keys?**

**Context:** If host-assisted decryption is used, apps need to share keys securely.

**To explore:**
- Key exchange protocol (app → host)
- Per-host key grants in B3nd
- Expiration and revocation
- Audit trail of key access
- Multiple hosts serving same content

**Decision:** _TBD_

---

## Domain Management

### Q5: Domain Verification Flow
`[ ]` **What's the complete domain verification flow?**

**Context:** Need to securely prove domain ownership.

**Proposed flow (DNS TXT):**
1. User runs `btc domains add myapp.com`
2. CLI shows: "Add TXT record: `_b3nd.myapp.com` → `app=052fee...`"
3. User adds DNS record
4. User runs `btc domains verify myapp.com`
5. CLI checks DNS, confirms match
6. Domain is now verified for this appPubkey

**Open questions:**
- What if DNS propagation is slow?
- Retry/polling strategy?
- Should verification be stored in B3nd or host-local?
- Re-verification interval?

**Decision:** _TBD_

---

### Q6: Multi-Domain Support
`[ ]` **Can one app serve multiple domains?**

**Context:** Common patterns like `myapp.com` + `www.myapp.com`, or multi-region domains.

**Scenarios:**
- `myapp.com` and `www.myapp.com` → same build
- `myapp.com` and `myapp.co.uk` → same build, different locales?
- `app.company.com` (customer white-label)

**Questions:**
- How are multiple domains listed in config?
- Does each need separate DNS verification?
- Any domain-specific configuration?

**Decision:** _TBD_

---

### Q7: Subdomain Wildcards
`[ ]` **Should `*.myapp.com` work?**

**Context:** Some apps need dynamic subdomains (multi-tenant SaaS).

**Examples:**
- `customer1.myapp.com` → same app, subdomain as context
- `feature-branch.preview.myapp.com` → preview deploys

**Questions:**
- How would DNS verification work for wildcards?
- How does the app know which subdomain was requested?
- Security implications of wildcard matching?

**Decision:** _TBD_

---

### Q8: Domain Transfer
`[ ]` **Can domain ownership transfer between app pubkeys?**

**Context:** App might be sold/transferred to new owner.

**Questions:**
- What's the flow to transfer?
- Grace period for old owner?
- Security against hostile takeover?

**Decision:** _TBD_

---

## Caching & Performance

### Q9: Cache Header Strategy
`[ ]` **What cache headers should the host set?**

**Context:** Host controls external caches via headers.

**Proposed defaults:**
- Hashed assets (`*.{hash}.js`): `Cache-Control: public, max-age=31536000, immutable`
- HTML files: `Cache-Control: public, max-age=0, must-revalidate` + ETag
- Manifest: Short TTL for quick deployments

**Questions:**
- How are asset hash patterns detected?
- Custom header configuration per-path?
- ETag generation strategy?
- Vary header handling?

**Decision:** _TBD_

---

### Q10: Target Pointer TTL
`[ ]` **How quickly should target pointer changes propagate?**

**Context:** When user runs `btc deploy`, how fast should change be live?

**Considerations:**
- External CDN cache TTL
- Host polling interval for target
- Push vs pull for updates
- Trade-off: fast deploys vs cache efficiency

**Decision:** _TBD_

---

## Developer Experience

### Q11: Preview Deployments
`[ ]` **How should preview/staging deployments work?**

**Context:** Developers want to preview builds before production.

**Options:**
- **A) Build hash URL**: `{buildHash}.preview.{host}/`
- **B) Named environments**: separate target pointers (`target-staging`, `target-production`)
- **C) Separate app pubkeys per environment**

**Questions:**
- How to share preview URLs securely?
- Password protection for previews?
- Auto-expiring preview URLs?

**Decision:** _TBD_

---

### Q12: Rollback UX
`[ ]` **What's the rollback experience?**

**Context:** Quick rollback is just updating target pointer.

**Questions:**
- `btc rollback` → to what? Previous? Specific version?
- Should versions be tagged/named?
- Rollback confirmation/safety?
- Audit log of deployments?

**Decision:** _TBD_

---

### Q13: Environment Variables
`[ ]` **How should environment-specific config work?**

**Context:** Apps often need different config per environment.

**Considerations:**
- Build-time vs runtime variables
- B3nd doesn't run code, so no runtime injection
- Options: separate builds, config endpoint, build-time baking

**Decision:** _TBD_

---

## Host Operations

### Q14: Host Health & Monitoring
`[ ]` **How do host operators monitor their servers?**

**Context:** Operators need visibility into host behavior.

**Questions:**
- Health check endpoint?
- Metrics (requests, cache hits, B3nd latency)?
- Error reporting?
- Request logging format?

**Decision:** _TBD_

---

### Q15: Host Registration
`[n/a]` **Should hosts register anywhere?**

**Resolution:** Out of scope. Per design principle #1, this is just software anyone can run. No registration, no network, no trust system. Users point their DNS to whatever host they run or trust.

**Decision:** No registration needed.

---

## Security

### Q16: Build Integrity Verification
`[ ]` **How is build integrity verified?**

**Context:** Ensure served content matches what was published.

**Questions:**
- Content hash verification at serve time?
- Signed manifests?
- Client-side verification option?

**Decision:** _TBD_

---

### Q17: Malicious Content Prevention
`[n/a]` **How to prevent abuse (phishing, malware hosting)?**

**Resolution:** Out of scope for the host software itself. Per design principle #1, this is just software. Content policy, abuse prevention, and moderation are concerns for:
- The B3nd network operators (Firecat)
- Individual host operators who choose what apps to serve
- DNS providers

The host software itself doesn't need abuse prevention features - it's like asking Nginx to prevent malware.

**Decision:** Not a host software concern.

---

## Serving Model (New from Extended Q3 Exploration)

### Q18: Direct vs Shell Serving
`[ ]` **When should host serve content directly vs serve a JS shell?**

**Context:** Two fundamentally different serving models emerged from Q3 exploration.

**Direct Serving:**
- Host reads from B3nd, serves HTTP response
- Fast, CDN-cacheable, SEO works
- Requires trust if content is encrypted (host decrypts)

**Shell Serving:**
- Host serves minimal JS loader
- Shell handles auth, fetches encrypted content, decrypts in browser
- Zero-trust, E2E encrypted, but slower and no SEO

**Questions:**
- Should apps declare their serving model in manifest?
- Can paths within same app use different models?
- Standard shell provided or apps bring their own?

**Decision:** _TBD_

---

### Q19: Host Authentication Layer
`[ ]` **How should host handle authentication for protected content?**

**Context:** When using host-assisted decryption, host must verify who can access.

**Options explored:**
- Session cookies (stateful or JWT-based stateless)
- Bearer tokens
- IP/network allowlist
- OAuth/OIDC integration
- Simple password (for previews)

**Questions:**
- Auth config schema in B3nd?
- Standard OAuth integration pattern?
- How stateless can auth be?
- Session cookie vs header-based for different use cases?

**Decision:** _TBD_

---

### Q20: Shell Standardization
`[ ]` **Should we provide a standard shell implementation?**

**Context:** Shell serving requires JS that handles auth, decryption, rendering.

**Options:**
- **A) Standard shell:** We provide shell, apps just provide encrypted content
- **B) BYO shell:** Apps provide their own shell, we just serve it
- **C) Shell SDK:** We provide building blocks, apps compose their shell

**Questions:**
- Flexibility vs consistency trade-off?
- How do apps customize auth UI in standard shell?
- Shell versioning and updates?

**Decision:** _TBD_

---

### Q21: Unreleased Build Access
`[ ]` **Should unreleased builds (pushed but not targeted) be accessible?**

**Context:** Build pushed to B3nd but target not yet updated.

**Current reality:**
- B3nd is readable by anyone (for public protocols)
- If build hash is known/guessed, content is accessible
- Host won't serve (no target), but direct B3nd access works

**Options:**
- Accept this (pushed == potentially accessible)
- Always encrypt builds (even if "public" when released)
- Use separate appPubkey for staging
- Preview-only encryption layer

**Decision:** _TBD_

---

### Q22: Host Key Management
`[ ]` **How should host public keys be managed?**

**Context:** For host-assisted decryption, apps encrypt to host's public key.

**Questions:**
- Key discovery mechanism (well-known endpoint? B3nd record?)
- Key rotation ceremony - grace period, old key acceptance
- Multiple host support - encrypt to multiple hosts
- Key compromise recovery

**Decision:** _TBD_

---

### Q23: Encryption Key Formats
`[ ]` **What cryptographic formats should be standardized?**

**Context:** Need interoperability between CLI, host, and browsers.

**Areas to specify:**
- Asymmetric encryption: X25519? Ed25519-to-X25519 conversion?
- Symmetric encryption: AES-GCM parameters (key size, IV)
- Key derivation: PBKDF2 parameters (iterations, salt)
- Key wrapping format
- Encrypted file format (IV + ciphertext structure)

**Decision:** _TBD_

---

## Next Steps

### Current Status
- **In Progress:** Q1 (Build format), Q3 (Encryption/serving)
- **Resolved:** Q15 (Host registration), Q17 (Malicious content) - out of scope
- **Open:** 21 questions remaining

### Priority Clusters

**Cluster 1: Core Architecture (blocks everything)**
1. Q1 (Build format) - individual files vs tarball
2. Q18 (Direct vs shell serving) - fundamental serving model
3. Q3/Q4 (Encryption flow) - host key model, trust

**Cluster 2: Encryption & Auth (enables private content)**
4. Q23 (Key formats) - crypto standards
5. Q22 (Host key management) - key discovery, rotation
6. Q19 (Host auth layer) - session/token handling
7. Q20 (Shell standardization) - if shell serving chosen
8. Q21 (Unreleased build access) - security implications

**Cluster 3: Domain & DNS (enables production use)**
9. Q5 (Domain verification) - DNS TXT flow
10. Q6 (Multi-domain) - www + apex, etc.
11. Q7 (Wildcards) - *.myapp.com support
12. Q8 (Domain transfer) - ownership change

**Cluster 4: Developer Experience (polish)**
13. Q2 (Manifest schema) - detailed spec
14. Q9 (Cache headers) - CDN integration
15. Q10 (Target TTL) - deploy propagation
16. Q11 (Previews) - staging workflow
17. Q12 (Rollback) - version management
18. Q13 (Env vars) - config handling

**Cluster 5: Operations (production readiness)**
19. Q14 (Health/monitoring) - observability
20. Q16 (Build integrity) - verification

### Recommended Next Action

Resolve Q1 (Build format) and Q18 (Serving model) together - they're interdependent. The serving model affects whether individual files matter for CDN caching.

Each question should be explored with:
- Concrete examples/scenarios
- Prototype code where helpful
- Final decision documented in `decisions/` as ADR
