/**
 * Output utilities for formatted CLI messages.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

export function success(message: string) {
  console.log(`${GREEN}✓${RESET} ${message}`);
}

export function error(message: string) {
  console.error(`${RED}✗${RESET} ${message}`);
}

export function warn(message: string) {
  console.log(`${YELLOW}⚠${RESET} ${message}`);
}

export function info(message: string) {
  console.log(`${BLUE}ℹ${RESET} ${message}`);
}

export function log(message: string) {
  console.log(message);
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function blue(text: string): string {
  return `${BLUE}${text}${RESET}`;
}

export function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

export function yellow(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}

export function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

/**
 * Print a table of key-value pairs.
 */
export function table(data: Record<string, string>) {
  const maxKeyLength = Math.max(...Object.keys(data).map((k) => k.length));

  for (const [key, value] of Object.entries(data)) {
    const paddedKey = key.padEnd(maxKeyLength);
    console.log(`  ${dim(paddedKey)}  ${value}`);
  }
}

/**
 * Print a list of items with bullets.
 */
export function list(items: string[]) {
  for (const item of items) {
    console.log(`  ${dim("•")} ${item}`);
  }
}
