# Exploration: Q3 - Encrypted Content Flow

**Question:** How should protected content be served?

## Context

Not all hosted content is public. Apps may need:
- Private dashboards behind login
- Password-protected staging sites
- Paid content requiring subscription
- Internal tools only accessible to authenticated users

Since content is stored on B3nd (a shared network), encryption provides access control rather than network-level restrictions.

---

## Encryption Fundamentals in B3nd

From B3nd's visibility model:

| Level | Key Derivation | Access |
|-------|---------------|--------|
| **Private** | `SALT:uri:ownerPubkey` | Owner only |
| **Protected** | `SALT:uri:password` | Anyone with password |
| **Public** | `SALT:uri:""` | Anyone (empty password) |

Content is encrypted **client-side before upload**. The B3nd network only sees ciphertext.

---

## The Challenge for App Hosting

In typical B3nd usage:
- User has wallet → decrypts their own data
- App JS handles decryption in browser

For app hosting:
- Visitor requests `https://myapp.com/dashboard`
- Host receives request
- Host needs to serve content
- Content may be encrypted

**Key question:** Who decrypts?

---

## Option A: Client-Side Decryption (Browser)

```
User → Host → Encrypted content → Browser → JS decrypts → Render
```

### Flow

1. Build is encrypted before upload
2. A small "loader" (unencrypted) is served first
3. Loader handles auth, gets decryption key
4. Loader fetches encrypted content
5. Loader decrypts in browser
6. Renders decrypted content

### Implementation

**Build structure:**
```
immutable://accounts/{appPubkey}/builds/{buildHash}/
├── manifest.json              # unencrypted
├── loader.html                # unencrypted - auth UI
├── loader.js                  # unencrypted - decryption logic
└── encrypted/
    ├── index.html.enc         # encrypted
    ├── dashboard.html.enc     # encrypted
    └── assets/
        └── main.js.enc        # encrypted
```

**Loader flow:**
```javascript
// loader.js (served unencrypted)
async function loadApp() {
  // 1. Check if user has session/key
  const key = await getDecryptionKey();
  if (!key) {
    showLoginUI();
    return;
  }

  // 2. Fetch encrypted content
  const encrypted = await fetch('/encrypted/index.html.enc');

  // 3. Decrypt
  const decrypted = await decrypt(encrypted, key);

  // 4. Render
  document.body.innerHTML = decrypted;
}
```

### Where does decryption key come from?

**Option A1: Password-based**
- User enters password
- Key derived: `PBKDF2(password + uri)`
- Same password used at build-time encryption

**Option A2: User wallet/account**
- User authenticates with B3nd wallet
- Key is user's account key (or derived from it)
- Content encrypted to user's pubkey

**Option A3: App-issued session**
- User authenticates with app's auth system
- App returns a session key
- Key was used to encrypt content

### Pros
- Host never sees plaintext
- Zero trust in host operator
- Works with any host

### Cons
- JavaScript required
- Initial load shows loader, not app
- SEO impossible for encrypted content
- Every asset needs decrypt call
- Can't use standard browser caching effectively
- Complex client-side orchestration

---

## Option B: Host-Assisted Decryption

```
User → Host → (Host decrypts) → Plaintext content → Browser
```

### Flow

1. Build is encrypted before upload
2. App shares decryption key with host
3. Request comes in
4. Host fetches encrypted content
5. Host decrypts
6. Host serves plaintext HTTP response

### Key Sharing Mechanism

App grants host access by writing to B3nd:

```
mutable://accounts/{appPubkey}/host-grants/{hostPubkey}
```

```json
{
  "contentKeyEncrypted": "...",  // Encrypted to host's pubkey
  "grantedAt": 1704067200000,
  "paths": ["/dashboard/*", "/api/*"],
  "publicPaths": ["/", "/login", "/assets/*"]
}
```

**Key exchange:**
1. Host has Ed25519 keypair (hostPubkey, hostPrivateKey)
2. Host publishes its pubkey (in config or well-known endpoint)
3. App encrypts content decryption key TO host's pubkey
4. App writes encrypted key to B3nd
5. Host reads grant, decrypts key with its private key
6. Host can now decrypt content

### Host Request Flow

```typescript
async function handleRequest(req: Request): Promise<Response> {
  const { appPubkey, path } = resolveApp(req);

  // Check if path is public
  const grant = await getHostGrant(appPubkey, HOST_PUBKEY);
  if (isPublicPath(path, grant.publicPaths)) {
    // Serve without decryption
    return serveFile(appPubkey, path, { encrypted: false });
  }

  // Private path - need decryption
  const contentKey = await decryptContentKey(grant.contentKeyEncrypted);
  const encrypted = await fetchEncryptedFile(appPubkey, path);
  const decrypted = await decrypt(encrypted, contentKey);

  return new Response(decrypted, {
    headers: { 'Content-Type': getContentType(path) }
  });
}
```

### Pros
- Normal HTTP serving - browser sees plaintext
- Standard browser caching works
- No JavaScript required
- SEO possible for decrypted content
- Simpler client experience

### Cons
- Host sees plaintext
- Trust required in host operator
- Key management complexity
- Revocation requires key rotation

---

## Option C: Hybrid Approach

Different content types handled differently:

| Content Type | Encryption | Who Decrypts |
|-------------|------------|--------------|
| Public pages (`/`, `/about`) | None | N/A |
| Semi-private (`/docs`) | Password-based | Host (password shared) |
| Private (`/dashboard`) | User-specific | Client-side |
| Sensitive data (`/api/secrets`) | User-specific | Client-side |

### Configuration

```json
{
  "encryption": {
    "default": "none",
    "paths": {
      "/docs/*": {
        "type": "password",
        "shareWithHost": true
      },
      "/dashboard/*": {
        "type": "user",
        "shareWithHost": false
      }
    }
  }
}
```

### Flow

```typescript
async function handleRequest(req: Request): Promise<Response> {
  const config = await getEncryptionConfig(appPubkey);
  const pathConfig = getPathConfig(path, config);

  switch (pathConfig.type) {
    case 'none':
      return serveUnencrypted(path);

    case 'password':
      if (pathConfig.shareWithHost) {
        return serveHostDecrypted(path);
      }
      return serveEncryptedForClient(path);

    case 'user':
      // Always client-side for user-specific encryption
      return serveEncryptedForClient(path);
  }
}
```

---

## Authentication Considerations

### Who verifies the user?

**Scenario 1: Password-protected site (no accounts)**
- User enters password
- Password = decryption key (or derives it)
- No user accounts, no session management
- Simple for staging/preview sites

**Scenario 2: App's own auth system**
- App has user accounts in B3nd
- User logs in via app's auth
- App's backend (or client) manages sessions
- Decryption key tied to user's session/account

**Scenario 3: B3nd wallet auth**
- User has B3nd wallet
- Content encrypted to wallet pubkey
- Wallet signs requests to prove identity
- Host can verify signature, serve content

### Host's Role in Auth

**Minimal (recommended):**
- Host doesn't do auth
- Host just serves content
- Auth is app's responsibility
- Host decrypts based on key grant, not user identity

**Extended (more complex):**
- Host verifies auth tokens
- Host gates access to encrypted content
- Requires host to understand app's auth system

---

## Security Analysis

### Threat Model

| Threat | Client-Side | Host-Assisted |
|--------|-------------|---------------|
| Malicious host | Safe - host sees ciphertext | Exposed - host sees plaintext |
| Network eavesdropping | Safe - E2E encrypted | Safe - HTTPS to browser |
| Key compromise | App re-encrypts | App re-encrypts + rotates host grant |
| Content leak | Only if browser compromised | If host leaks |

### Key Rotation

When keys need to change:

**Client-side encryption:**
1. Generate new key
2. Re-encrypt all content
3. Upload new build
4. Deploy (update target pointer)

**Host-assisted:**
1. Generate new content key
2. Re-encrypt all content
3. Upload new build
4. Re-encrypt key for each host
5. Update host grants
6. Deploy

---

## Recommended Approach

**For MVP:** Support both, let apps choose per deployment.

### Default: Unencrypted Public Content
Most apps are public - no encryption overhead.

### Password-Protected: Host-Assisted
For staging/preview sites where:
- Simple password protection is enough
- SEO doesn't matter
- Trust the host operator

```bash
btc build --password-protect "staging123"
# Encrypts build, configures host grant with password-derived key
```

### User-Specific: Client-Side
For apps with user accounts where:
- Each user sees different content
- Content must stay encrypted to user
- Zero-trust in host

This requires app to implement the loader pattern.

---

## Implementation Details

### Host Grant Schema

```typescript
interface HostGrant {
  hostPubkey: string;
  contentKeyEncrypted: string;  // Encrypted to host's X25519 pubkey
  grantedAt: number;
  expiresAt?: number;
  allowedPaths: string[];       // Glob patterns host can decrypt
  publicPaths: string[];        // Paths served without decryption
  revokedAt?: number;           // Soft delete
}
```

### Host Key Discovery

How does app find host's pubkey?

**Option 1: Well-known endpoint**
```
GET https://apps.fire.cat/.well-known/b3nd-host
{
  "hostPubkey": "052fee...",
  "capabilities": ["decrypt", "cache"],
  "version": "1.0.0"
}
```

**Option 2: B3nd record**
```
mutable://open/hosts/apps.fire.cat
{
  "hostPubkey": "052fee...",
  ...
}
```

**Option 3: Manual configuration**
```bash
btc hosts add apps.fire.cat --pubkey 052fee...
```

---

## Questions for Discussion

1. **Trust model:** Are we comfortable with hosts seeing decrypted content? Or must we support zero-trust?

2. **Key rotation frequency:** How often should content keys rotate? On every deploy? Scheduled?

3. **Revocation latency:** If host grant is revoked, how quickly must host stop serving?

4. **Multiple hosts:** If app is served by multiple hosts, each needs a grant. Manageable?

5. **Audit trail:** Should decryption events be logged? Where?

---

## Next Steps

- [ ] Define exact HostGrant schema
- [ ] Prototype key exchange flow
- [ ] Test with real encrypted content
- [ ] Document in ADR after decision
