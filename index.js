#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

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

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  let size = bytes;
  do {
    size /= 1024;
    i++;
  } while (size >= 1024 && i < units.length - 1);
  return size.toFixed(1) + " " + units[i];
}

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

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Size Calculation ───────────────────────────────────────────────────────

function getDirSize(dirPath) {
  // Use du for speed on macOS/Linux
  if (process.platform !== "win32") {
    try {
      const output = execSync(`du -sk "${dirPath}" 2>/dev/null`, {
        encoding: "utf8",
        timeout: 30000,
      });
      const kb = parseInt(output.split("\t")[0], 10);
      if (!isNaN(kb)) return kb * 1024;
    } catch {
      // fall through to Node.js fallback
    }
  }

  // Node.js fallback (Windows or if du fails)
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        } else if (entry.isDirectory()) {
          total += getDirSize(fullPath);
        }
      } catch {
        // permission errors, broken symlinks, etc.
      }
    }
  } catch {
    // can't read directory
  }
  return total;
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

function showResults(results, rootPath, dryRun) {
  const totalSize = results.reduce((sum, r) => sum + r.size, 0);

  if (results.length === 0) {
    console.log(`  ${c.green}✓${c.reset} No cleanable artifacts found in ${c.bold}${rootPath}${c.reset}`);
    console.log(`  ${c.dim}Your workspace is already clean!${c.reset}`);
    console.log();
    return;
  }

  // Sort by size descending
  results.sort((a, b) => b.size - a.size);

  const label = dryRun
    ? `${c.yellow}[DRY RUN]${c.reset} Would delete`
    : "Found";

  console.log(
    `  ${label} ${c.bold}${results.length}${c.reset} artifact${results.length === 1 ? "" : "s"} totaling ${c.bold}${c.green}${formatSize(totalSize)}${c.reset}`
  );
  console.log();

  // Calculate column widths
  const maxNameLen = Math.max(...results.map((r) => r.name.length));

  for (const r of results) {
    const relPath = path.relative(rootPath, path.dirname(r.path));
    const displayPath = relPath || ".";
    const sizeStr = formatSize(r.size);
    const padding = " ".repeat(Math.max(0, maxNameLen - r.name.length));
    console.log(
      `    ${c.red}${r.name}${c.reset}${padding}  ${c.bold}${sizeStr.padStart(10)}${c.reset}  ${c.dim}${displayPath}${c.reset}`
    );
  }

  console.log();
  console.log(
    `  ${c.bold}Total: ${c.green}${formatSize(totalSize)}${c.reset}`
  );
  console.log();
}

// ─── Deletion ───────────────────────────────────────────────────────────────

function deleteResults(results) {
  const total = results.length;
  let freed = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    const r = results[i];
    const progress = `[${i + 1}/${total}]`;

    if (isTTY) {
      process.stdout.write(
        `\r  ${c.cyan}${progress}${c.reset} Deleting ${c.dim}${r.name}${c.reset}` +
          " ".repeat(20)
      );
    }

    try {
      fs.rmSync(r.path, { recursive: true, force: true });
      freed += r.size;
    } catch (err) {
      failed++;
      if (isTTY) {
        process.stdout.write("\r" + " ".repeat(70) + "\r");
      }
      console.log(
        `  ${c.red}✗${c.reset} Failed to delete ${r.name}: ${err.message}`
      );
    }
  }

  // Clear progress line
  if (isTTY) {
    process.stdout.write("\r" + " ".repeat(70) + "\r");
  }

  console.log(
    `  ${c.green}✓${c.reset} Deleted ${c.bold}${total - failed}${c.reset} artifact${total - failed === 1 ? "" : "s"}, freed ${c.bold}${c.green}${formatSize(freed)}${c.reset}`
  );

  if (failed > 0) {
    console.log(
      `  ${c.yellow}⚠${c.reset} ${failed} artifact${failed === 1 ? "" : "s"} could not be deleted`
    );
  }

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

  if (results.length === 0) {
    showResults(results, targetPath, args.dryRun);
    process.exit(0);
  }

  // Calculate sizes (with progress)
  const sizeSpinner = useColor
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"];

  for (let i = 0; i < results.length; i++) {
    if (isTTY) {
      process.stdout.write(
        `\r  ${c.cyan}${sizeSpinner[i % sizeSpinner.length]}${c.reset} Calculating sizes... ${c.dim}(${i + 1}/${results.length})${c.reset}`
      );
    }
    results[i].size = getDirSize(results[i].path);
  }

  // Clear spinner
  if (isTTY) {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }

  // Display results
  showResults(results, targetPath, args.dryRun);

  // Dry run stops here
  if (args.dryRun) {
    console.log(
      `  ${c.dim}Run without --dry-run to delete these artifacts${c.reset}`
    );
    console.log();
    process.exit(0);
  }

  // Confirm deletion
  if (!args.yes) {
    const answer = await prompt(
      `  ${c.yellow}?${c.reset} Delete all ${results.length} artifact${results.length === 1 ? "" : "s"}? ${c.dim}(y/N)${c.reset} `
    );
    console.log();

    if (answer !== "y" && answer !== "yes") {
      console.log(`  ${c.dim}Aborted. Nothing was deleted.${c.reset}`);
      console.log();
      process.exit(0);
    }
  }

  // Delete
  deleteResults(results);
}

main().catch((err) => {
  console.error(`  ${c.red}Error:${c.reset} ${err.message}`);
  process.exit(1);
});
