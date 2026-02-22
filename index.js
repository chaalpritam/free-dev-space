#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

// ─── Version ────────────────────────────────────────────────────────────────

const VERSION = "1.0.0";

// ─── ANSI Colors ────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const noColor = "NO_COLOR" in process.env;
const useColor = isTTY && !noColor;

const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  blue: useColor ? "\x1b[34m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  white: useColor ? "\x1b[37m" : "",
};

// ─── Utilities ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    path: null,
    dryRun: false,
    yes: false,
    version: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-d" || arg === "--dry-run") args.dryRun = true;
    else if (arg === "-y" || arg === "--yes") args.yes = true;
    else if (arg === "-v" || arg === "--version") args.version = true;
    else if (arg === "-h" || arg === "--help") args.help = true;
    else if (!arg.startsWith("-")) args.path = arg;
  }

  return args;
}

// ─── Display ────────────────────────────────────────────────────────────────

function showBanner() {
  console.log();
  console.log(
    `  ${c.bold}${c.cyan}free-dev-space${c.reset} ${c.dim}v${VERSION}${c.reset}`
  );
  console.log(
    `  ${c.dim}Clean regenerable dev artifacts and reclaim disk space${c.reset}`
  );
  console.log();
}

function showHelp() {
  showBanner();
  console.log(`  ${c.bold}USAGE${c.reset}`);
  console.log(`    npx free-dev-space [path] [options]`);
  console.log();
  console.log(`  ${c.bold}OPTIONS${c.reset}`);
  console.log(`    -d, --dry-run    Preview what would be deleted`);
  console.log(`    -y, --yes        Skip confirmation prompt`);
  console.log(`    -v, --version    Show version`);
  console.log(`    -h, --help       Show help`);
  console.log();
  console.log(`  ${c.bold}EXAMPLES${c.reset}`);
  console.log(`    npx free-dev-space ~/dev`);
  console.log(`    npx free-dev-space . --dry-run`);
  console.log(`    npx free-dev-space ~/projects -y`);
  console.log();
  console.log(`  ${c.bold}WHAT IT CLEANS${c.reset}`);
  console.log(
    `    node_modules, Pods (ios), .next, .nuxt, .gradle (android),`
  );
  console.log(
    `    build (android/app), .cxx (android/app), dist, vendor (Ruby),`
  );
  console.log(
    `    .build, target (Rust), __pycache__, .venv, venv, .dart_tool,`
  );
  console.log(`    .turbo, .parcel-cache`);
  console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  showBanner();

  // Resolve target path
  const targetPath = path.resolve(args.path || ".");

  // Validate path exists
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      console.error(
        `  ${c.red}✗${c.reset} Not a directory: ${c.bold}${targetPath}${c.reset}`
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `  ${c.red}✗${c.reset} Path not found: ${c.bold}${targetPath}${c.reset}`
    );
    process.exit(1);
  }

  console.log(
    `  ${c.dim}Scanning${c.reset} ${c.bold}${targetPath}${c.reset}`
  );
  console.log();

  // TODO: scan, display results, confirm, delete
  console.log(`  ${c.dim}Scanner not implemented yet${c.reset}`);
}

main().catch((err) => {
  console.error(`  ${c.red}Error:${c.reset} ${err.message}`);
  process.exit(1);
});
