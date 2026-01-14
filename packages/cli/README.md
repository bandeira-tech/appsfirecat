# Firecat CLI

Command-line tool for managing domains, deploying content, and interacting with Apps Firecat infrastructure.

## Installation

```bash
# Install globally with Deno
deno install -A -n firecat jsr:@appsfirecat/cli

# Or run directly
deno run -A jsr:@appsfirecat/cli <command>
```

## Quick Start

```bash
# Configure default settings
firecat config set backendUrl "https://testnet-evergreen.fire.cat"
firecat config set defaultTarget "immutable://accounts/:key/site/"

# Register a custom domain
firecat domain register example.com "immutable://open/sites/example/www/"

# Deploy your site
firecat deploy ./dist

# Check host health
firecat host health testnet-static-content.fire.cat
```

## Commands

### Domain Management

```bash
# Register a custom domain
firecat domain register <domain> <target>

# Check domain status
firecat domain check <domain>

# List all domains (if supported)
firecat domain list

# Remove a domain
firecat domain remove <domain>
```

### Content Deployment

```bash
# Deploy to specific target
firecat deploy <directory> <target>

# Deploy using defaultTarget from config
firecat deploy <directory>
```

The `:key` placeholder in targets is replaced with your `publicKey` from config.

### Host Interaction

```bash
# Get host information
firecat host info <url>

# Check host health
firecat host health <url>
```

### Configuration

```bash
# Set a config value
firecat config set <key> <value>

# Get a config value
firecat config get <key>

# List all config
firecat config list
```

**Config Keys:**
- `backendUrl` - B3nd backend URL
- `publicKey` - Your Ed25519 public key (hex)
- `privateKey` - Your Ed25519 private key (hex)
- `defaultTarget` - Default deployment target URI

## Examples

### Deploy a React app

```bash
# Build your app
npm run build

# Set default target
firecat config set defaultTarget "immutable://accounts/:key/myapp/"

# Deploy
firecat deploy ./build
```

### Set up custom domain

```bash
# Deploy content
firecat deploy ./dist "immutable://open/sites/example/www/"

# Register domain
firecat domain register example.com "immutable://open/sites/example/www/"

# Point DNS to your host (A or CNAME record)
# example.com → 1.2.3.4
# or
# example.com → CNAME → apphost.fire.cat
```

### Check infrastructure health

```bash
# Check main host
firecat host health testnet-static-content.fire.cat

# Check custom domain host
firecat host info apphost.fire.cat
```

## Configuration Storage

Config is stored in `~/.config/firecat/config.json`

## Development

```bash
# Run from source
cd packages/cli
deno task dev --help

# Test commands
deno run -A mod.ts domain check example.com
deno run -A mod.ts config list
```
