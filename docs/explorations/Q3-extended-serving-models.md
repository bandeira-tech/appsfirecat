# Extended Exploration: Serving Models & Encryption

This exploration expands on Q3 (Encrypted Content Flow) and introduces a new dimension: **how** content is served, not just **what** is served.

## Two Orthogonal Dimensions

### Dimension 1: Content Encryption
- **Unencrypted** - anyone can read from B3nd
- **Encrypted** - content is ciphertext in B3nd

### Dimension 2: Serving Model
- **Direct serving** - host serves content as HTTP response
- **Shell serving** - host serves JS loader that fetches/renders content client-side

These combine into multiple configurations depending on use case.

---

## Scenario Matrix

| Scenario | Encryption | Serving | Who Decrypts | Auth Required |
|----------|------------|---------|--------------|---------------|
| Public website | None | Direct | N/A | No |
| Public SPA | None | Direct | N/A | No |
| Intranet site | Encrypted | Direct (host decrypts) | Host | Yes - before request |
| Private dashboard | Encrypted | Shell + client decrypt | Browser | Yes - in shell |
| Preview/staging | Encrypted | Direct (host decrypts) | Host | Yes - password |
| Unreleased build | N/A | Not served | N/A | N/A (no target) |
| Paid content | Encrypted | Shell + client decrypt | Browser | Yes - subscription |

---

## Scenario 1: Public Website

**Example:** Marketing site, blog, documentation

```
Build: unencrypted
Target: points to build
DNS: configured
Result: Anyone can access
```

### Flow
```
User → https://myapp.com/about
         ↓
      Host resolves domain → appPubkey
         ↓
      Host reads mutable://accounts/{appPubkey}/target
         ↓
      Host reads immutable://accounts/{appPubkey}/builds/{hash}/about.html
         ↓
      Host serves directly with cache headers
         ↓
      User sees page
```

### Characteristics
- Simplest case
- Full CDN caching
- SEO works
- No encryption overhead
- No shell needed

---

## Scenario 2: Intranet / Corporate Site

**Example:** Internal tools, company wiki, admin panels

### Requirements
- Only authorized employees can access
- Should work like a normal website (no JS shell)
- SEO doesn't matter (internal)
- SSO/corporate auth integration

### Approach: Host-Gated with Encrypted Content

```
Build: encrypted to host's public key
Host: has private key, can decrypt
Auth: host validates auth before serving
```

### Encryption Model

**At build time:**
```typescript
// App knows host's public key
const HOST_PUBKEY = "052fee...";  // Host's X25519 public key

// Encrypt each file to host's key
for (const file of buildFiles) {
  const encrypted = await encryptToPublicKey(file.content, HOST_PUBKEY);
  await b3nd.write(`immutable://.../${file.path}`, encrypted);
}
```

**Host decryption:**
```typescript
// Host has corresponding private key
const HOST_PRIVATE_KEY = process.env.HOST_PRIVATE_KEY;

async function serveFile(uri: string): Promise<Response> {
  const encrypted = await b3nd.read(uri);
  const decrypted = await decryptWithPrivateKey(encrypted, HOST_PRIVATE_KEY);
  return new Response(decrypted);
}
```

### Authentication Gate

**Problem:** How does host know to decrypt for this request?

**Option A: Session Cookie**
```typescript
async function handleRequest(req: Request): Promise<Response> {
  const session = await validateSession(req.cookies.get('session'));
  if (!session) {
    return redirectToLogin();
  }

  // Session valid → serve decrypted content
  return serveDecryptedFile(req.path);
}
```

**Option B: Auth Header (API/Bearer)**
```typescript
async function handleRequest(req: Request): Promise<Response> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!await validateToken(token)) {
    return new Response('Unauthorized', { status: 401 });
  }

  return serveDecryptedFile(req.path);
}
```

**Option C: IP/Network Allowlist**
```typescript
async function handleRequest(req: Request): Promise<Response> {
  const clientIP = req.headers.get('X-Forwarded-For');
  if (!isAllowedNetwork(clientIP)) {
    return new Response('Forbidden', { status: 403 });
  }

  return serveDecryptedFile(req.path);
}
```

### Where does auth live?

**Problem:** Host is supposed to be stateless. Where do sessions/auth come from?

**Approach 1: External Auth Provider (OAuth/OIDC)**
```
User → Host → Redirect to IdP → Login → Callback → Session cookie → Access
```

Host validates tokens against external IdP. No state in host.

**Approach 2: Auth Config in B3nd**
```
mutable://accounts/{appPubkey}/auth-config
{
  "type": "oauth",
  "provider": "https://auth.company.com",
  "clientId": "...",
  "allowedUsers": ["alice@company.com", "bob@company.com"]
}
```

Host reads auth config from B3nd, validates against external provider.

**Approach 3: Password Hash in B3nd**
```
mutable://accounts/{appPubkey}/auth-config
{
  "type": "password",
  "passwordHash": "bcrypt:$2b$..."
}
```

Simple password protection. Host validates password, sets session cookie.

### Flow Diagram

```
User → https://internal.company.com/dashboard
         ↓
      Host: No session cookie
         ↓
      Host reads auth-config from B3nd
         ↓
      Redirect to login (OAuth or password form)
         ↓
      User authenticates
         ↓
      Host sets session cookie (stateless JWT or signed cookie)
         ↓
      Redirect back to /dashboard
         ↓
      Host: Valid session cookie
         ↓
      Host decrypts and serves content
```

---

## Scenario 3: Private Dashboard (Client-Side Decrypt)

**Example:** User-specific data, sensitive personal info, E2E encrypted app

### Requirements
- Host NEVER sees plaintext
- User's key decrypts content
- True E2E encryption
- Works with user wallets

### Approach: Shell + Client Decryption

The host serves a **shell application** that:
1. Handles authentication
2. Obtains decryption key
3. Fetches encrypted content
4. Decrypts in browser
5. Renders

### Build Structure

```
immutable://accounts/{appPubkey}/builds/{hash}/
├── shell/                      # Unencrypted loader
│   ├── index.html             # Entry point
│   ├── shell.js               # Auth + decrypt logic
│   └── shell.css              # Minimal styles
├── encrypted/                  # Encrypted app content
│   ├── app.html.enc
│   ├── app.js.enc
│   └── assets/
│       └── *.enc
└── manifest.json              # Describes structure
```

### Shell Implementation

```html
<!-- shell/index.html (served unencrypted) -->
<!DOCTYPE html>
<html>
<head>
  <title>Loading...</title>
  <link rel="stylesheet" href="/shell/shell.css">
</head>
<body>
  <div id="shell-root">
    <!-- Login form or loading spinner -->
  </div>
  <div id="app-root" style="display:none">
    <!-- Decrypted app renders here -->
  </div>
  <script src="/shell/shell.js"></script>
</body>
</html>
```

```javascript
// shell/shell.js (served unencrypted)
class AppShell {
  constructor() {
    this.decryptionKey = null;
    this.init();
  }

  async init() {
    // Check for existing session
    const session = await this.loadSession();
    if (session) {
      await this.loadApp(session.decryptionKey);
    } else {
      this.showLogin();
    }
  }

  showLogin() {
    document.getElementById('shell-root').innerHTML = `
      <form id="login-form">
        <input type="password" name="password" placeholder="Enter password">
        <button type="submit">Unlock</button>
      </form>
    `;
    document.getElementById('login-form').onsubmit = (e) => {
      e.preventDefault();
      this.handleLogin(e.target.password.value);
    };
  }

  async handleLogin(password) {
    // Derive decryption key from password
    const key = await this.deriveKey(password);

    // Try to decrypt a test file to validate password
    try {
      await this.testDecrypt(key);
      await this.saveSession({ decryptionKey: key });
      await this.loadApp(key);
    } catch (e) {
      alert('Invalid password');
    }
  }

  async deriveKey(password) {
    // PBKDF2 or similar
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode(window.APP_SALT), // From manifest
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async loadApp(key) {
    this.decryptionKey = key;

    // Hide shell, show app container
    document.getElementById('shell-root').style.display = 'none';
    document.getElementById('app-root').style.display = 'block';

    // Fetch and decrypt main app
    const encryptedHtml = await fetch('/encrypted/app.html.enc').then(r => r.arrayBuffer());
    const decryptedHtml = await this.decrypt(encryptedHtml, key);

    // Inject decrypted content
    document.getElementById('app-root').innerHTML = decryptedHtml;

    // Load decrypted JS
    const encryptedJs = await fetch('/encrypted/app.js.enc').then(r => r.arrayBuffer());
    const decryptedJs = await this.decrypt(encryptedJs, key);

    // Execute decrypted JS
    const script = document.createElement('script');
    script.textContent = decryptedJs;
    document.body.appendChild(script);
  }

  async decrypt(encrypted, key) {
    // AES-GCM decryption
    const iv = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  async saveSession(session) {
    // Store in sessionStorage (tab-scoped)
    // Or localStorage (persistent)
    // Or IndexedDB for more control
    sessionStorage.setItem('app-session', JSON.stringify(session));
  }

  async loadSession() {
    const stored = sessionStorage.getItem('app-session');
    return stored ? JSON.parse(stored) : null;
  }
}

new AppShell();
```

### Characteristics
- Host only serves ciphertext
- Zero knowledge of content
- Password never sent to server
- All decryption in browser
- Session stored client-side

### Trade-offs

| Aspect | Direct Serve | Shell + Client Decrypt |
|--------|-------------|----------------------|
| Host trust | Required | Not required |
| Initial load | Fast | Slower (shell + decrypt) |
| SEO | Works | Not possible |
| CDN caching | Full | Only shell cached |
| Complexity | Lower | Higher |
| Browser requirement | Any | Modern (WebCrypto) |

---

## Scenario 4: Preview / Staging

**Example:** Build deployed but not yet released, needs review

### Requirements
- Only authorized reviewers can see
- Should look/work like production
- Temporary access
- Multiple builds can be in preview simultaneously

### Approach: Password-Protected Direct Serve

```
Build: encrypted to host key
Access: via special preview URL with password
```

### Preview URL Patterns

**Option A: Build hash in URL**
```
https://preview.myapp.com/{buildHash}/
```

**Option B: Named preview**
```
https://staging.myapp.com/  (points to staging target)
https://preview-{id}.myapp.com/
```

**Option C: Query parameter**
```
https://myapp.com/?preview={buildHash}&token={accessToken}
```

### Access Control for Previews

```
mutable://accounts/{appPubkey}/preview-config
{
  "enabled": true,
  "password": "bcrypt:$2b$...",
  "allowedBuilds": ["abc123", "def456"],  // Or "*" for any
  "expiresAt": 1704153600000
}
```

Host checks:
1. Is this a preview request? (URL pattern)
2. Is preview enabled for this app?
3. Is the build allowed?
4. Is password valid?
5. Not expired?

Then decrypt and serve.

---

## Scenario 5: Unreleased Build

**Example:** Build pushed to B3nd but target not yet updated

### Current State
```
mutable://accounts/{appPubkey}/target
  → { buildHash: "v1-abc123" }  // Current production

immutable://accounts/{appPubkey}/builds/v1-abc123/  // Live
immutable://accounts/{appPubkey}/builds/v2-def456/  // Pushed but not targeted
```

### Key Question: Can someone access v2-def456?

**If unencrypted:** Yes, if they know/guess the build hash
- B3nd is public storage
- Anyone can read `immutable://accounts/{appPubkey}/builds/v2-def456/`
- Host won't serve it (no target), but direct B3nd access works

**If encrypted:** No, even with hash
- Content is ciphertext
- Without decryption key, useless
- Host won't serve (no target pointing to it)

### Recommendation

For unreleased builds that shouldn't leak:
1. Always encrypt builds
2. Or use a separate appPubkey for staging/preview
3. Or accept that pushed == potentially accessible

---

## Scenario 6: Paid Content / Subscription

**Example:** Premium features, paywalled content, licensed software

### Requirements
- Only paying users can access
- Subscription status can change (cancel, expire)
- Content should not be extractable even by paying users
- Works with existing payment systems

### Approach: Shell + Per-User Encryption

Each user gets content encrypted to their unique key:

```
User signs up → App generates user key → Content encrypted per-user
```

**Problem:** Can't pre-encrypt to unknown users

**Solution: Key Wrapping**

```
Content Key (CK): Random, encrypts actual content
User Key (UK): Derived from user's password/wallet
Wrapped Key: CK encrypted to UK

Build:
- Content encrypted with CK
- CK wrapped for each authorized user
```

### Structure

```
immutable://accounts/{appPubkey}/builds/{hash}/
├── shell/                      # Public
├── encrypted/                  # Encrypted with Content Key
└── keys/                       # Per-user wrapped keys
    ├── manifest.json          # List of authorized users
    └── {userPubkey}.key       # CK wrapped to this user's key
```

### Flow

```
User → Shell → Authenticate → Get wrapped key → Unwrap CK → Decrypt content
```

### Subscription Changes

When subscription ends:
1. Remove user's wrapped key from `keys/`
2. Next build won't include their key
3. Existing cached content still works until cache expires
4. Re-subscription: re-add wrapped key

---

## Host Public Key Model

### The Concept

Host publishes a public key. Apps encrypt to this key.

```
Host keypair: (hostPubkey, hostPrivateKey)
  - hostPubkey: published, anyone can encrypt TO host
  - hostPrivateKey: secret, only host can decrypt
```

### Key Discovery

**Via well-known endpoint:**
```
GET https://apps.fire.cat/.well-known/b3nd-host
{
  "hostPubkey": "052fee...",
  "keyType": "x25519",
  "capabilities": ["decrypt"],
  "keyRotation": {
    "current": "052fee...",
    "previous": "043abc...",  // Still accepted during rotation
    "rotatedAt": 1704067200000
  }
}
```

**Via B3nd:**
```
mutable://open/hosts/{hostname}
{
  "hostPubkey": "052fee...",
  ...
}
```

### Encryption at Build Time

```typescript
// btc CLI during build
async function encryptBuild(buildDir: string, hostPubkey: string) {
  // Generate content key for this build
  const contentKey = await generateContentKey();

  // Encrypt each file with content key (symmetric, fast)
  for (const file of buildFiles) {
    const encrypted = await encryptSymmetric(file.content, contentKey);
    await write(`immutable://.../${file.path}`, encrypted);
  }

  // Wrap content key for host (asymmetric)
  const wrappedKey = await encryptToPublicKey(contentKey, hostPubkey);

  // Store wrapped key
  await write(`immutable://.../.host-key`, wrappedKey);
}
```

### Host Decryption

```typescript
async function decryptFile(appPubkey: string, buildHash: string, path: string) {
  // Get wrapped content key
  const wrappedKey = await read(`immutable://accounts/${appPubkey}/builds/${buildHash}/.host-key`);

  // Unwrap with host's private key
  const contentKey = await decryptWithPrivateKey(wrappedKey, HOST_PRIVATE_KEY);

  // Get encrypted file
  const encrypted = await read(`immutable://accounts/${appPubkey}/builds/${buildHash}/${path}`);

  // Decrypt with content key
  const decrypted = await decryptSymmetric(encrypted, contentKey);

  return decrypted;
}
```

### Preventing Unauthorized Decryption

**Problem:** If host can decrypt everything, what stops it from serving to wrong people?

**Answer:** Authentication layer (see Scenario 2)

The encryption ensures:
- Content is private in B3nd (network can't read)
- Only authorized hosts can decrypt
- Host decides WHO gets decrypted content

The authentication ensures:
- Host validates identity before serving
- Unauthenticated requests get rejected
- Auth rules defined in B3nd config

### Multi-Host Support

App can encrypt to multiple hosts:

```
immutable://accounts/{appPubkey}/builds/{hash}/
├── .host-keys/
│   ├── apps.fire.cat.key      # Wrapped for Firecat host
│   ├── my-server.com.key      # Wrapped for self-hosted
│   └── cdn.example.com.key    # Wrapped for another host
└── encrypted/
    └── ...
```

### Key Rotation

When host rotates keys:
1. Host announces new pubkey (keeps old temporarily)
2. New builds encrypt to new key
3. Host can decrypt both old and new during transition
4. Eventually old key retired

---

## Decision Framework

### When to use Direct Serving

✓ Public content (no encryption needed)
✓ Intranet with trusted host (host can decrypt)
✓ Preview/staging (temporary access)
✓ Performance critical (no JS overhead)
✓ SEO matters
✓ Simple deployment

### When to use Shell + Client Decrypt

✓ Zero-trust requirement (host must not see content)
✓ E2E encrypted applications
✓ User-specific encryption
✓ Paid/subscription content (prevent extraction)
✓ Sensitive personal data

### Hybrid Approach

Many apps need both:
- `/` - public, direct serve
- `/blog` - public, direct serve, SEO important
- `/app` - private, shell + client decrypt
- `/admin` - intranet, host decrypt with auth

---

## Open Questions from This Exploration

1. **Shell standardization:** Should we provide a standard shell, or apps bring their own?

2. **Key derivation standard:** What KDF parameters? Need interoperability.

3. **Session management in shell:** sessionStorage vs localStorage vs IndexedDB? Security vs convenience.

4. **Offline support:** Can shell cache decrypted content for offline use? Service worker implications?

5. **Auth provider integration:** Standard way to plug in OAuth/OIDC? Host config format?

6. **Key rotation ceremony:** Exact flow for host key rotation? Grace period?

7. **Multiple encryption layers:** Can content be encrypted to BOTH host AND user? Double wrapping?

8. **Manifest for encryption:** Should manifest indicate encryption status per-path?

---

## Next Steps

- [ ] Define encryption key formats (X25519 vs Ed25519-to-X25519)
- [ ] Spec out host auth-config schema
- [ ] Prototype shell implementation
- [ ] Test with real build (React app)
- [ ] Document in ADR after decisions
