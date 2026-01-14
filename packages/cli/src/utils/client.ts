/**
 * B3nd client wrapper for CLI operations.
 */

import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import { getBackendUrl } from "./config-store.ts";

let clientInstance: HttpClient | null = null;

/**
 * Get or create B3nd client instance.
 */
export async function getClient(): Promise<HttpClient> {
  if (!clientInstance) {
    const backendUrl = await getBackendUrl();
    clientInstance = new HttpClient({ url: backendUrl });
  }
  return clientInstance;
}

/**
 * Reset client instance (useful for testing or config changes).
 */
export function resetClient() {
  clientInstance = null;
}
