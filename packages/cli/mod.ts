#!/usr/bin/env -S deno run -A
/**
 * Firecat CLI - Manage domains, deploy content, and interact with hosts.
 *
 * Usage:
 *   firecat <command> [options]
 *
 * Commands:
 *   domain    Manage custom domains
 *   deploy    Deploy content to B3nd
 *   host      Interact with host nodes
 *   config    Manage CLI configuration
 *
 * Examples:
 *   firecat domain register example.com "immutable://open/sites/example/www/"
 *   firecat deploy ./dist
 *   firecat host health testnet-static-content.fire.cat
 */

import { parseArgs } from "@std/cli";
import * as output from "./src/utils/output.ts";
import * as domainCmd from "./src/commands/domain.ts";
import * as deployCmd from "./src/commands/deploy.ts";
import * as hostCmd from "./src/commands/host.ts";
import * as configCmd from "./src/commands/config.ts";

const VERSION = "0.1.0";

function showVersion() {
  console.log(`firecat v${VERSION}`);
}

function showHelp() {
  console.log(`
${output.bold("firecat")} ${output.dim(`v${VERSION}`)} - Apps Firecat CLI

${output.bold("Usage:")}
  firecat <command> [options]

${output.bold("Commands:")}
  domain    Manage custom domains (register, check, list, remove)
  deploy    Deploy content to B3nd
  host      Interact with host nodes (info, health)
  config    Manage CLI configuration (set, get, list)

${output.bold("Options:")}
  -h, --help       Show help
  -v, --version    Show version

${output.bold("Examples:")}
  # Register a custom domain
  firecat domain register example.com "immutable://open/sites/example/www/"

  # Deploy a website
  firecat deploy ./dist "immutable://accounts/:key/site/"

  # Check host health
  firecat host health testnet-static-content.fire.cat

  # Configure default target
  firecat config set defaultTarget "immutable://accounts/:key/site/"

${output.bold("Get help for a command:")}
  firecat domain --help
  firecat deploy --help

${output.bold("Documentation:")}
  https://github.com/bandeira-tech/appsfirecat
`);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "version"],
    alias: { h: "help", v: "version" },
    stopEarly: true,
  });

  // Show version
  if (args.version) {
    showVersion();
    return;
  }

  // Get command
  const command = args._[0]?.toString();

  // Show help if no command or --help
  if (!command || args.help) {
    showHelp();
    return;
  }

  // Route to command handlers
  try {
    switch (command) {
      case "domain": {
        const subcommand = args._[1]?.toString();

        if (!subcommand || subcommand === "help") {
          await domainCmd.help();
          return;
        }

        switch (subcommand) {
          case "register": {
            const domain = args._[2]?.toString();
            const target = args._[3]?.toString();

            if (!domain || !target) {
              output.error("Missing required arguments");
              output.log("");
              output.log("Usage: firecat domain register <domain> <target>");
              Deno.exit(1);
            }

            await domainCmd.register(domain, target);
            break;
          }

          case "check": {
            const domain = args._[2]?.toString();

            if (!domain) {
              output.error("Missing required argument: domain");
              output.log("");
              output.log("Usage: firecat domain check <domain>");
              Deno.exit(1);
            }

            await domainCmd.check(domain);
            break;
          }

          case "list": {
            await domainCmd.list();
            break;
          }

          case "remove": {
            const domain = args._[2]?.toString();

            if (!domain) {
              output.error("Missing required argument: domain");
              output.log("");
              output.log("Usage: firecat domain remove <domain>");
              Deno.exit(1);
            }

            await domainCmd.remove(domain);
            break;
          }

          default:
            output.error(`Unknown subcommand: ${subcommand}`);
            output.log("");
            await domainCmd.help();
            Deno.exit(1);
        }
        break;
      }

      case "deploy": {
        const subcommand = args._[1]?.toString();

        if (subcommand === "help") {
          deployCmd.help();
          return;
        }

        const directory = args._[1]?.toString();
        const target = args._[2]?.toString();

        if (!directory) {
          output.error("Missing required argument: directory");
          output.log("");
          output.log("Usage: firecat deploy <directory> [target]");
          Deno.exit(1);
        }

        await deployCmd.deploy(directory, target);
        break;
      }

      case "host": {
        const subcommand = args._[1]?.toString();

        if (!subcommand || subcommand === "help") {
          hostCmd.help();
          return;
        }

        switch (subcommand) {
          case "info": {
            const url = args._[2]?.toString();

            if (!url) {
              output.error("Missing required argument: url");
              output.log("");
              output.log("Usage: firecat host info <url>");
              Deno.exit(1);
            }

            await hostCmd.info(url);
            break;
          }

          case "health": {
            const url = args._[2]?.toString();

            if (!url) {
              output.error("Missing required argument: url");
              output.log("");
              output.log("Usage: firecat host health <url>");
              Deno.exit(1);
            }

            await hostCmd.health(url);
            break;
          }

          default:
            output.error(`Unknown subcommand: ${subcommand}`);
            output.log("");
            hostCmd.help();
            Deno.exit(1);
        }
        break;
      }

      case "config": {
        const subcommand = args._[1]?.toString();

        if (!subcommand || subcommand === "help") {
          configCmd.help();
          return;
        }

        switch (subcommand) {
          case "set": {
            const key = args._[2]?.toString();
            const value = args._[3]?.toString();

            if (!key || !value) {
              output.error("Missing required arguments");
              output.log("");
              output.log("Usage: firecat config set <key> <value>");
              Deno.exit(1);
            }

            await configCmd.set(key, value);
            break;
          }

          case "get": {
            const key = args._[2]?.toString();

            if (!key) {
              output.error("Missing required argument: key");
              output.log("");
              output.log("Usage: firecat config get <key>");
              Deno.exit(1);
            }

            await configCmd.get(key);
            break;
          }

          case "list": {
            await configCmd.list();
            break;
          }

          default:
            output.error(`Unknown subcommand: ${subcommand}`);
            output.log("");
            configCmd.help();
            Deno.exit(1);
        }
        break;
      }

      default:
        output.error(`Unknown command: ${command}`);
        output.log("");
        showHelp();
        Deno.exit(1);
    }
  } catch (error) {
    output.error(`Fatal error: ${error.message}`);
    if (error.stack) {
      console.error(output.dim(error.stack));
    }
    Deno.exit(1);
  }
}

// Run if this is the main module
if (import.meta.main) {
  main();
}
