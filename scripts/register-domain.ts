#!/usr/bin/env -S deno run -A
/**
 * Register a custom domain to point to a B3nd target.
 *
 * Usage:
 *   deno run -A scripts/register-domain.ts <domain> <target>
 *
 * Examples:
 *   # Register domain to point to immutable content
 *   deno run -A scripts/register-domain.ts example.com "immutable://open/static-content/example.com/www/"
 *
 *   # Register domain to point to account content
 *   deno run -A scripts/register-domain.ts mysite.org "immutable://accounts/abc123/site/"
 *
 *   # List registered domain
 *   deno run -A scripts/register-domain.ts example.com
 *
 * Environment:
 *   BACKEND_URL - B3nd backend URL (default: https://testnet-evergreen.fire.cat)
 */

import "jsr:@std/dotenv/load";
import { HttpClient } from "jsr:@bandeira-tech/b3nd-sdk";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ||
  "https://testnet-evergreen.fire.cat";

interface DomainMapping {
  target: string;
  created: number;
}

async function main() {
  const [domain, target] = Deno.args;

  if (!domain) {
    console.log(`
Usage: deno run -A scripts/register-domain.ts <domain> [target]

Arguments:
  domain  - The custom domain (e.g., example.com)
  target  - B3nd URI to serve from (e.g., immutable://open/mysite/)

If target is omitted, shows current registration for the domain.

Examples:
  # Register a domain
  deno run -A scripts/register-domain.ts example.com "immutable://open/static-content/example.com/www/"

  # Check registration
  deno run -A scripts/register-domain.ts example.com
`);
    Deno.exit(1);
  }

  const client = new HttpClient({ url: BACKEND_URL });
  const normalizedDomain = domain.toLowerCase();
  const domainUri = `mutable://open/domains/${normalizedDomain}`;

  // If no target provided, show current registration
  if (!target) {
    console.log(`Checking registration for: ${normalizedDomain}`);
    console.log(`URI: ${domainUri}`);
    console.log(`Backend: ${BACKEND_URL}\n`);

    const result = await client.read<DomainMapping | string>(domainUri);

    if (result.success && result.record?.data) {
      const data = result.record.data;
      if (typeof data === "string") {
        console.log(`Target: ${data}`);
      } else {
        console.log(`Target: ${data.target}`);
        if (data.created) {
          console.log(`Created: ${new Date(data.created).toISOString()}`);
        }
      }
    } else {
      console.log("Domain not registered.");
    }
    return;
  }

  // Register the domain
  console.log(`Registering domain: ${normalizedDomain}`);
  console.log(`Target: ${target}`);
  console.log(`URI: ${domainUri}`);
  console.log(`Backend: ${BACKEND_URL}\n`);

  const mapping: DomainMapping = {
    target,
    created: Date.now(),
  };

  const result = await client.write(domainUri, mapping);

  if (result.success) {
    console.log("Domain registered successfully!");
    console.log(`\nTo use this domain:`);
    console.log(`1. Point your DNS to your host server`);
    console.log(`2. Requests to ${normalizedDomain} will serve from:`);
    console.log(`   ${target}`);
  } else {
    console.error(`Failed to register domain: ${result.error}`);
    Deno.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  Deno.exit(1);
});
