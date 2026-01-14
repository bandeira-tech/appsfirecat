/**
 * Host node interaction commands.
 */

import * as output from "../utils/output.ts";
import type { HealthResponse, HostInfoResponse } from "@host-protocol";

/**
 * Get host information.
 */
export async function info(hostUrl: string) {
  const url = normalizeUrl(hostUrl, "/api/v1/info");

  output.info(`Fetching host info from: ${output.bold(hostUrl)}`);
  output.log("");

  try {
    const response = await fetch(url);

    if (!response.ok) {
      output.error(`HTTP ${response.status}: ${response.statusText}`);
      Deno.exit(1);
    }

    const data: HostInfoResponse = await response.json();

    output.success("Host info:");
    output.log("");
    output.table({
      "Type": data.type,
      "Version": data.version,
      "Public Key": data.pubkey.substring(0, 32) + "...",
      "Capabilities": data.capabilities.join(", "),
      "Target": data.target || output.dim("not configured"),
    });
  } catch (error) {
    output.error(`Failed to connect: ${error.message}`);
    Deno.exit(1);
  }
}

/**
 * Check host health.
 */
export async function health(hostUrl: string) {
  const url = normalizeUrl(hostUrl, "/api/v1/health");

  output.info(`Checking health of: ${output.bold(hostUrl)}`);
  output.log("");

  try {
    const response = await fetch(url);

    if (!response.ok) {
      output.error(`HTTP ${response.status}: ${response.statusText}`);
      Deno.exit(1);
    }

    const data: HealthResponse = await response.json();

    if (data.status === "ok") {
      output.success("Host is healthy");
    } else if (data.status === "degraded") {
      output.warn("Host is degraded");
    } else {
      output.error("Host is unhealthy");
    }

    output.log("");
    output.table({
      "Status": formatStatus(data.status),
      "Backend": data.backend?.url || output.dim("none"),
      "Backend Status": data.backend
        ? formatStatus(data.backend.status)
        : output.dim("n/a"),
      "Target": data.target || output.dim("not configured"),
      "Timestamp": new Date(data.timestamp).toISOString(),
    });

    if (data.status !== "ok") {
      Deno.exit(1);
    }
  } catch (error) {
    output.error(`Failed to connect: ${error.message}`);
    Deno.exit(1);
  }
}

/**
 * Normalize host URL and append path.
 */
function normalizeUrl(hostUrl: string, path: string): string {
  // Add protocol if missing
  if (!hostUrl.startsWith("http://") && !hostUrl.startsWith("https://")) {
    hostUrl = `https://${hostUrl}`;
  }

  // Remove trailing slash
  hostUrl = hostUrl.replace(/\/$/, "");

  return `${hostUrl}${path}`;
}

/**
 * Format status with color.
 */
function formatStatus(status: string): string {
  switch (status) {
    case "ok":
      return output.green("ok");
    case "degraded":
      return output.yellow("degraded");
    case "error":
      return output.red("error");
    default:
      return status;
  }
}

/**
 * Show help for host commands.
 */
export function help() {
  console.log(`
${output.bold("firecat host")} - Interact with host nodes

${output.bold("Usage:")}
  firecat host info <url>
  firecat host health <url>

${output.bold("Commands:")}
  info      Get host information (type, version, capabilities)
  health    Check host health status

${output.bold("Examples:")}
  # Get host info
  firecat host info https://testnet-static-content.fire.cat

  # Check health (protocol optional)
  firecat host health testnet-static-content.fire.cat
`);
}
