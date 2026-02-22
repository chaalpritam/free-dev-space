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

// ─── Target Definitions ─────────────────────────────────────────────────────

const TARGETS = [
  { name: "node_modules", match: "direct" },
  { name: "Pods", match: "parent", parent: "ios" },
  { name: ".next", match: "direct" },
  { name: ".nuxt", match: "direct" },
  { name: ".gradle", match: "parent", parent: "android" },
  { name: "build", match: "parentPath", parents: ["android", "app"] },
  { name: ".cxx", match: "parentPath", parents: ["android", "app"] },
  { name: "dist", match: "direct" },
  { name: "vendor", match: "sibling", sibling: "Gemfile" },
  { name: ".build", match: "direct" },
  { name: "target", match: "sibling", sibling: "Cargo.toml" },
  { name: "__pycache__", match: "direct" },
  { name: ".venv", match: "direct" },
  { name: "venv", match: "direct" },
  { name: ".dart_tool", match: "direct" },
  { name: ".turbo", match: "direct" },
  { name: ".parcel-cache", match: "direct" },
];

const TARGET_NAMES = new Set(TARGETS.map((t) => t.name));

// Dirs to never recurse into (besides matched targets)
const SKIP_DIRS = new Set([".git"]);

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

// ─── Scanner ────────────────────────────────────────────────────────────────

function isTargetMatch(entryName, entryDir) {
  for (const target of TARGETS) {
    if (target.name !== entryName) continue;

    const parentName = path.basename(entryDir);

    switch (target.match) {
      case "direct":
        return true;

      case "parent":
        if (parentName === target.parent) return true;
        break;

      case "parentPath": {
        const parts = entryDir.split(path.sep);
        const len = parts.length;
        if (
          len >= 2 &&
          parts[len - 1] === target.parents[1] &&
          parts[len - 2] === target.parents[0]
        ) {
          return true;
        }
        break;
      }

      case "sibling": {
        const siblingPath = path.join(entryDir, target.sibling);
        try {
          fs.accessSync(siblingPath, fs.constants.F_OK);
          return true;
        } catch {
          break;
        }
      }
    }
  }
  return false;
}

function scan(rootPath) {
  const results = [];
  const spinner = useColor
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"];
  let spinIdx = 0;
  let scanCount = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;

      // Skip hidden dirs we don't care about and .git
      if (SKIP_DIRS.has(name)) continue;

      const fullPath = path.join(dir, name);

      if (isTargetMatch(name, dir)) {
        results.push({ name, path: fullPath, size: 0 });
        // Don't recurse into matched dirs
        continue;
      }

      // Don't recurse into known target names that didn't match safety checks
      // (they're likely still big dirs we don't want to scan inside)
      if (TARGET_NAMES.has(name)) continue;

      // Show scanning progress
      scanCount++;
      if (isTTY && scanCount % 50 === 0) {
        process.stdout.write(
          `\r  ${c.cyan}${spinner[spinIdx % spinner.length]}${c.reset} Scanning... ${c.dim}${scanCount} directories checked${c.reset}`
        );
        spinIdx++;
      }

      walk(fullPath);
    }
  }

  walk(rootPath);

  // Clear spinner line
  if (isTTY && scanCount > 0) {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }

  return results;
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

  // Scan
  const results = scan(targetPath);

  // TODO: calculate sizes, display results, confirm, delete
  console.log(`  ${c.dim}Found ${results.length} artifact(s)${c.reset}`);
  for (const r of results) {
    console.log(`    ${c.red}${r.name}${c.reset}  ${c.dim}${r.path}${c.reset}`);
  }
}

main().catch((err) => {
  console.error(`  ${c.red}Error:${c.reset} ${err.message}`);
  process.exit(1);
});
