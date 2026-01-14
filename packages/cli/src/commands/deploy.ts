/**
 * Content deployment commands.
 */

import { walk } from "@std/fs";
import { relative, join } from "@std/path";
import { getClient } from "../utils/client.ts";
import * as output from "../utils/output.ts";
import { getConfigValue } from "../utils/config-store.ts";

/**
 * Deploy a directory to B3nd.
 */
export async function deploy(
  sourceDir: string,
  targetUri?: string,
) {
  const client = await getClient();

  // Resolve target URI
  if (!targetUri) {
    targetUri = await getConfigValue("defaultTarget");
    if (!targetUri) {
      output.error("No target specified");
      output.log("");
      output.log("Either provide a target or set a default:");
      output.log(`  ${output.dim("firecat config set defaultTarget")} <uri>`);
      output.log("");
      output.log("Examples:");
      output.list([
        'firecat deploy ./dist "immutable://open/sites/mysite/www/"',
        'firecat config set defaultTarget "immutable://accounts/:key/site/"',
      ]);
      Deno.exit(1);
    }
  }

  // Replace :key placeholder with public key if present
  if (targetUri.includes(":key")) {
    const publicKey = await getConfigValue("publicKey");
    if (!publicKey) {
      output.error("Target contains :key but no publicKey configured");
      output.log("");
      output.log("Set your public key:");
      output.log(`  ${output.dim("firecat config set publicKey")} <hex>`);
      Deno.exit(1);
    }
    targetUri = targetUri.replace(/:key/g, publicKey);
  }

  // Normalize target URI (ensure trailing slash)
  const normalizedTarget = targetUri.endsWith("/") ? targetUri : `${targetUri}/`;

  output.info(`Deploying: ${output.bold(sourceDir)}`);
  output.log(`Target: ${output.dim(normalizedTarget)}`);
  output.log("");

  // Collect files to deploy
  const files: Array<{ path: string; content: Uint8Array }> = [];

  try {
    for await (const entry of walk(sourceDir, { includeDirs: false })) {
      if (entry.isFile) {
        const relativePath = relative(sourceDir, entry.path);
        const content = await Deno.readFile(entry.path);
        files.push({ path: relativePath, content });
      }
    }
  } catch (error) {
    output.error(`Failed to read source directory: ${error.message}`);
    Deno.exit(1);
  }

  if (files.length === 0) {
    output.warn("No files found to deploy");
    Deno.exit(1);
  }

  output.info(`Found ${files.length} files to deploy`);
  output.log("");

  // Deploy each file
  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const uri = `${normalizedTarget}${file.path}`;
    const sizeKb = (file.content.length / 1024).toFixed(1);

    try {
      const result = await client.write(uri, file.content);

      if (result.success) {
        output.success(`${file.path} ${output.dim(`(${sizeKb} KB)`)}`);
        successCount++;
      } else {
        output.error(`${file.path}: ${result.error}`);
        errorCount++;
      }
    } catch (error) {
      output.error(`${file.path}: ${error.message}`);
      errorCount++;
    }
  }

  output.log("");
  if (errorCount === 0) {
    output.success(
      `Deployment complete! ${successCount} files deployed to:`,
    );
    output.log(`  ${output.cyan(normalizedTarget)}`);
  } else {
    output.warn(
      `Deployment finished with errors: ${successCount} succeeded, ${errorCount} failed`,
    );
    Deno.exit(1);
  }
}

/**
 * Show help for deploy commands.
 */
export function help() {
  console.log(`
${output.bold("firecat deploy")} - Deploy content to B3nd

${output.bold("Usage:")}
  firecat deploy <directory> [target]
  firecat deploy <directory>  # Uses defaultTarget from config

${output.bold("Arguments:")}
  directory   Source directory to deploy (e.g., ./dist, ./build)
  target      B3nd URI to deploy to (optional if defaultTarget is set)

${output.bold("Placeholders:")}
  :key        Replaced with your publicKey from config

${output.bold("Examples:")}
  # Deploy to specific target
  firecat deploy ./dist "immutable://open/sites/mysite/www/"

  # Deploy to account with :key placeholder
  firecat deploy ./build "immutable://accounts/:key/site/"

  # Set default target and deploy
  firecat config set defaultTarget "immutable://accounts/:key/site/"
  firecat deploy ./dist

${output.bold("Note:")} Files are uploaded individually. Large deployments may take time.
`);
}
