# Exploration: Q1 - Build Storage Format

**Question:** Should builds use manifest + individual files or single tarball?

## The Options

### Option A: Manifest + Individual Files

```
immutable://accounts/{appPubkey}/builds/{buildHash}/
├── manifest.json
├── index.html
├── assets/
│   ├── main.a1b2c3.js
│   ├── main.d4e5f6.css
│   └── logo.png
└── _headers (optional)
```

**Write operation:**
```typescript
// For each file in build output
for (const file of buildFiles) {
  await client.write(
    `immutable://accounts/${appPubkey}/builds/${buildHash}/${file.path}`,
    gzipEncode(file.content)
  );
}

// Write manifest last
await client.write(
  `immutable://accounts/${appPubkey}/builds/${buildHash}/manifest.json`,
  manifest
);
```

**Read operation (per request):**
```typescript
// 1. Get target
const target = await client.read(`mutable://accounts/${appPubkey}/target`);

// 2. Get manifest (cacheable)
const manifest = await client.read(
  `immutable://accounts/${appPubkey}/builds/${target.buildHash}/manifest.json`
);

// 3. Get specific file
const file = await client.read(
  `immutable://accounts/${appPubkey}/builds/${target.buildHash}/${requestPath}`
);
```

### Option B: Single Tarball

```
immutable://accounts/{appPubkey}/builds/{buildHash}
→ gzipped tarball containing entire build
```

**Write operation:**
```typescript
const tarball = await createTarball(buildDir);
const gzipped = await gzip(tarball);
await client.write(
  `immutable://accounts/${appPubkey}/builds/${buildHash}`,
  gzipped
);
```

**Read operation:**
```typescript
// 1. Get target
const target = await client.read(`mutable://accounts/${appPubkey}/target`);

// 2. Get entire tarball
const tarball = await client.read(
  `immutable://accounts/${appPubkey}/builds/${target.buildHash}`
);

// 3. Extract requested file from tarball (in memory)
const file = extractFromTarball(tarball, requestPath);
```

### Option C: Tarball with Byte-Range Index

```
immutable://accounts/{appPubkey}/builds/{buildHash}
→ gzipped tarball

immutable://accounts/{appPubkey}/builds/{buildHash}/index.json
→ { "index.html": { offset: 0, length: 1234 }, ... }
```

Allows range requests but adds complexity.

---

## Comparison Matrix

| Aspect | Individual Files | Single Tarball | Tarball + Index |
|--------|------------------|----------------|-----------------|
| **Write complexity** | Many writes | One write | Two writes |
| **Write time** | Slower (serial) | Fast | Fast |
| **B3nd storage** | Overhead per file | Minimal | Minimal + index |
| **Read latency (uncached)** | 2 reads (manifest + file) | 1 read + extract | 2 reads + range |
| **CDN cacheable** | Yes, per file | Yes, whole tarball | Complex |
| **Partial cache** | Yes | No | Yes |
| **Hot file caching** | Excellent | All or nothing | Possible |
| **Deploy time** | Proportional to files | Proportional to size | Proportional to size |
| **Rollback** | Just pointer change | Just pointer change | Just pointer change |
| **Diff builds** | File-level | None | Byte-level |

---

## Deep Dive: CDN Caching Behavior

### Individual Files (Option A)

```
Request: GET /assets/main.a1b2c3.js
         ↓
     CDN Cache Key: myapp.com/assets/main.a1b2c3.js
         ↓
     Cache HIT? → Serve from edge
     Cache MISS? → Origin (host) → B3nd → Serve + Cache
```

**Advantages:**
- Hashed assets cached ~forever (`Cache-Control: immutable`)
- Unchanged files between deploys stay cached
- HTML files short-cached, quick updates
- Individual file invalidation possible

**Deploy scenario:**
- Deploy v1: CDN caches all files
- Deploy v2: Only changed files need fetching
- Unchanged assets (logo.png) still cached

### Single Tarball (Option B)

```
Request: GET /assets/main.a1b2c3.js
         ↓
     Host must extract from tarball
         ↓
     CDN can cache extracted response
         ↓
     But host processes every request
```

**The problem:** Host must:
1. Fetch tarball from B3nd (or cache it locally)
2. Extract requested file
3. Serve

This means:
- Host needs local tarball cache (no longer stateless)
- OR fetches full tarball per cache miss
- CDN caches final responses, but origin is heavy

**Host caching necessity:**
```typescript
// Host needs its own cache layer
const tarballCache = new Map<string, Tarball>();

async function getFile(buildHash: string, path: string) {
  let tarball = tarballCache.get(buildHash);
  if (!tarball) {
    tarball = await fetchTarballFromB3nd(buildHash);
    tarballCache.set(buildHash, tarball);  // Memory/disk cache
  }
  return extractFile(tarball, path);
}
```

This contradicts the "host is stateless" principle.

---

## Deep Dive: Write Performance

### B3nd Write Characteristics

Need to understand:
- Is there per-write overhead in B3nd/Firecat?
- Any batching capability?
- Parallel writes possible?

**Individual files approach:**
```typescript
// Parallel writes (if B3nd supports)
await Promise.all(
  buildFiles.map(file =>
    client.write(`immutable://.../${file.path}`, file.content)
  )
);

// Or batched writes (if API supports)
await client.writeBatch(
  buildFiles.map(file => ({
    uri: `immutable://.../${file.path}`,
    data: file.content
  }))
);
```

**Questions to answer:**
- [ ] Does B3nd HttpClient support parallel writes?
- [ ] Is there a batch write API?
- [ ] What's the latency per write?
- [ ] Any rate limits?

---

## Deep Dive: SPA Routing

Both approaches need to handle SPA routing:

```
Request: GET /dashboard/settings
         ↓
     File exists? → Serve file
     File not found? → Serve index.html (SPA fallback)
```

**Individual files:** Check if file exists in manifest
```typescript
const manifest = await getManifest(buildHash);
const file = manifest.files[requestPath]
  ? requestPath
  : 'index.html';  // SPA fallback
```

**Tarball:** Check tarball contents
```typescript
const tarball = await getTarball(buildHash);
const file = tarball.hasFile(requestPath)
  ? requestPath
  : 'index.html';
```

Both work, but individual files can check manifest without fetching content.

---

## Hybrid Consideration

What if we separate metadata from content?

```
immutable://accounts/{appPubkey}/builds/{buildHash}/meta
→ manifest with file listing

immutable://accounts/{appPubkey}/builds/{buildHash}/content
→ tarball with actual files
```

Host fetches meta first (small), then ranges into content (or caches whole tarball).

---

## Recommendation Direction

**Leaning toward Option A (Individual Files)** because:

1. **Stateless host** - no local cache needed, pure reader
2. **CDN-friendly** - per-file caching works naturally
3. **Efficient updates** - unchanged files stay cached
4. **Simpler read path** - direct file fetch, no extraction

**Concerns to address:**
- Write performance with many files
- B3nd storage overhead for many small records

**Mitigation ideas:**
- Parallel writes during publish
- Only store files above size threshold individually?
- Accept slightly slower publish for better serve performance

---

## Questions for Discussion

1. What's the typical build size we're optimizing for?
   - Small (< 100 files, < 5MB): Individual files fine
   - Large (1000+ files, 100MB+): Might need hybrid

2. What's more important: fast publish or fast serve?
   - Fast serve → Individual files (CDN-friendly)
   - Fast publish → Tarball (one write)

3. Should host maintain any local state?
   - No state → Individual files (read from B3nd)
   - Local cache OK → Tarball could work

4. Are there B3nd batching capabilities we should use?

---

## Next Steps

- [ ] Prototype both approaches
- [ ] Measure B3nd write performance for many small files
- [ ] Test with real-world build (React/Vite app)
- [ ] Document decision in ADR
