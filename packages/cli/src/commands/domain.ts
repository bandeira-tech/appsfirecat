/**
 * Domain management commands.
 */

import { getClient } from "../utils/client.ts";
import * as output from "../utils/output.ts";
import { getBackendUrl } from "../utils/config-store.ts";

interface DomainMapping {
  target: string;
  owner?: string;
  created?: number;
}

/**
 * Register a custom domain to point to a B3nd target.
 */
export async function register(domain: string, target: string) {
  const client = await getClient();
  const normalizedDomain = domain.toLowerCase();
  const domainUri = `mutable://open/domains/${normalizedDomain}`;

  output.info(`Registering domain: ${output.bold(normalizedDomain)}`);
  output.log(`Target: ${output.dim(target)}`);
  output.log(`URI: ${output.dim(domainUri)}`);
  output.log("");

  const mapping: DomainMapping = {
    target,
    created: Date.now(),
  };

  const result = await client.write(domainUri, mapping);

  if (result.success) {
    output.success("Domain registered successfully!");
    output.log("");
    output.log("Next steps:");
    output.list([
      "Point your DNS to your host server (A or CNAME record)",
      `Requests to ${output.cyan(normalizedDomain)} will serve from:`,
      `  ${output.dim(target)}`,
    ]);
  } else {
    output.error(`Failed to register domain: ${result.error}`);
    Deno.exit(1);
  }
}

/**
 * Check domain registration status.
 */
export async function check(domain: string) {
  const client = await getClient();
  const normalizedDomain = domain.toLowerCase();
  const domainUri = `mutable://open/domains/${normalizedDomain}`;

  output.info(`Checking registration for: ${output.bold(normalizedDomain)}`);
  output.log("");

  const result = await client.read<DomainMapping | string>(domainUri);

  if (result.success && result.record?.data) {
    const data = result.record.data;
    let target: string;
    let created: number | undefined;

    if (typeof data === "string") {
      target = data;
    } else {
      target = data.target;
      created = data.created;
    }

    output.success("Domain is registered");
    output.log("");
    output.table({
      "Domain": normalizedDomain,
      "Target": target,
      "Created": created
        ? new Date(created).toISOString()
        : output.dim("unknown"),
      "Registry": domainUri,
    });
  } else {
    output.warn("Domain not registered");
    output.log("");
    output.log("To register this domain:");
    output.log(
      `  ${
        output.dim("firecat domain register")
      } ${normalizedDomain} ${output.dim("<target>")}`,
    );
  }
}

/**
 * List all registered domains (scan registry).
 */
export async function list() {
  const client = await getClient();
  const baseUri = "mutable://open/domains/";

  output.info("Scanning for registered domains...");
  output.log("");

  try {
    // Try to list domains under the base URI
    const result = await client.read(baseUri);

    if (result.success) {
      output.warn("Domain listing not yet implemented (requires list API)");
      output.log("");
      output.log("Available commands:");
      output.list([
        `${output.bold("check")} - Check if a specific domain is registered`,
        `${output.bold("register")} - Register a new domain`,
      ]);
    } else {
      output.error("Failed to access domain registry");
    }
  } catch (_error) {
    output.warn("Domain listing requires B3nd list API support");
  }
}

/**
 * Remove a domain registration.
 */
export async function remove(domain: string) {
  const client = await getClient();
  const normalizedDomain = domain.toLowerCase();
  const domainUri = `mutable://open/domains/${normalizedDomain}`;

  output.info(`Removing domain: ${output.bold(normalizedDomain)}`);
  output.log("");

  // Check if domain exists first
  const checkResult = await client.read<DomainMapping | string>(domainUri);

  if (!checkResult.success || !checkResult.record?.data) {
    output.warn("Domain not registered");
    Deno.exit(1);
  }

  // Delete by writing null/empty
  const result = await client.write(domainUri, null);

  if (result.success) {
    output.success("Domain removed successfully");
  } else {
    output.error(`Failed to remove domain: ${result.error}`);
    Deno.exit(1);
  }
}

/**
 * Show help for domain commands.
 */
export async function help() {
  const backendUrl = await getBackendUrl();
  console.log(`
${output.bold("firecat domain")} - Manage custom domains

${output.bold("Usage:")}
  firecat domain register <domain> <target>
  firecat domain check <domain>
  firecat domain list
  firecat domain remove <domain>

${output.bold("Commands:")}
  register   Register a custom domain to point to a B3nd target
  check      Check if a domain is registered and show details
  list       List all registered domains
  remove     Remove a domain registration

${output.bold("Examples:")}
  # Register a domain
  firecat domain register example.com "immutable://open/sites/example/www/"

  # Check domain status
  firecat domain check example.com

  # Remove a domain
  firecat domain remove example.com

${output.bold("Backend:")} ${output.dim(backendUrl)}
`);
}
