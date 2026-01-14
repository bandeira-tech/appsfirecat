/**
 * Configuration management commands.
 */

import * as output from "../utils/output.ts";
import {
  loadConfig,
  setConfigValue,
  type CliConfig,
} from "../utils/config-store.ts";

/**
 * Set a configuration value.
 */
export async function set(key: string, value: string) {
  const validKeys: Array<keyof CliConfig> = [
    "backendUrl",
    "privateKey",
    "publicKey",
    "defaultTarget",
  ];

  if (!validKeys.includes(key as keyof CliConfig)) {
    output.error(`Invalid config key: ${key}`);
    output.log("");
    output.log("Valid keys:");
    output.list(validKeys);
    Deno.exit(1);
  }

  await setConfigValue(key as keyof CliConfig, value);
  output.success(`Set ${output.bold(key)} = ${output.dim(value)}`);
}

/**
 * Get a configuration value.
 */
export async function get(key: string) {
  const config = await loadConfig();
  const value = config[key as keyof CliConfig];

  if (value === undefined) {
    output.warn(`${key} is not set`);
    Deno.exit(1);
  }

  console.log(value);
}

/**
 * List all configuration values.
 */
export async function list() {
  const config = await loadConfig();

  output.info("Configuration:");
  output.log("");

  if (Object.keys(config).length === 0) {
    output.warn("No configuration set");
    output.log("");
    output.log("Set values with:");
    output.log(`  ${output.dim("firecat config set")} <key> <value>`);
    return;
  }

  output.table({
    "Backend URL": config.backendUrl || output.dim("not set"),
    "Public Key": config.publicKey
      ? config.publicKey.substring(0, 16) + "..."
      : output.dim("not set"),
    "Private Key": config.privateKey
      ? output.dim("[hidden]")
      : output.dim("not set"),
    "Default Target": config.defaultTarget || output.dim("not set"),
  });
}

/**
 * Show help for config commands.
 */
export function help() {
  console.log(`
${output.bold("firecat config")} - Manage CLI configuration

${output.bold("Usage:")}
  firecat config set <key> <value>
  firecat config get <key>
  firecat config list

${output.bold("Commands:")}
  set    Set a configuration value
  get    Get a configuration value
  list   List all configuration values

${output.bold("Configuration Keys:")}
  backendUrl      B3nd backend URL (default: testnet-evergreen.fire.cat)
  publicKey       Your Ed25519 public key (hex)
  privateKey      Your Ed25519 private key (hex)
  defaultTarget   Default deployment target URI

${output.bold("Examples:")}
  # Set backend
  firecat config set backendUrl "https://mainnet.fire.cat"

  # Set default deployment target
  firecat config set defaultTarget "immutable://accounts/:key/site/"

  # View config
  firecat config list
`);
}
