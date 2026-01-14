/**
 * Local configuration store for CLI settings.
 * Stores config in ~/.config/firecat/config.json
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export interface CliConfig {
  backendUrl?: string;
  privateKey?: string;
  publicKey?: string;
  defaultTarget?: string;
}

/**
 * Get config directory path.
 */
function getConfigDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error("Could not determine home directory");
  }
  return join(home, ".config", "firecat");
}

/**
 * Get config file path.
 */
function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/**
 * Load configuration from disk.
 */
export async function loadConfig(): Promise<CliConfig> {
  try {
    const content = await Deno.readTextFile(getConfigPath());
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {};
    }
    throw error;
  }
}

/**
 * Save configuration to disk.
 */
export async function saveConfig(config: CliConfig): Promise<void> {
  const configDir = getConfigDir();
  await ensureDir(configDir);

  const configPath = getConfigPath();
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
  );
}

/**
 * Get a single config value.
 */
export async function getConfigValue(key: keyof CliConfig): Promise<string | undefined> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a single config value.
 */
export async function setConfigValue(
  key: keyof CliConfig,
  value: string,
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

/**
 * Get backend URL from config or env.
 */
export async function getBackendUrl(): Promise<string> {
  const envUrl = Deno.env.get("BACKEND_URL");
  if (envUrl) return envUrl;

  const configUrl = await getConfigValue("backendUrl");
  if (configUrl) return configUrl;

  // Default
  return "https://testnet-evergreen.fire.cat";
}
