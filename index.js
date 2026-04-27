#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// ─── Version ────────────────────────────────────────────────────────────────

const VERSION = "1.1.0";

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
    noDocker: false,
    version: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-d" || arg === "--dry-run") args.dryRun = true;
    else if (arg === "-y" || arg === "--yes") args.yes = true;
    else if (arg === "--no-docker") args.noDocker = true;
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
  console.log(`    -y, --yes        Skip confirmation prompts`);
  console.log(`        --no-docker  Skip Docker scan and cleanup`);
  console.log(`    -v, --version    Show version`);
  console.log(`    -h, --help       Show help`);
  console.log();
  console.log(`  ${c.bold}EXAMPLES${c.reset}`);
  console.log(`    npx free-dev-space ~/dev`);
  console.log(`    npx free-dev-space . --dry-run`);
  console.log(`    npx free-dev-space ~/projects -y`);
  console.log(`    npx free-dev-space . --no-docker`);
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
  console.log(
    `    Plus unused Docker images, containers, volumes, and build cache`
  );
  console.log(`    when Docker is running (skip with --no-docker).`);
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

// ─── Docker ─────────────────────────────────────────────────────────────────

function checkDockerAvailable() {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function parseDockerSize(str) {
  if (!str || typeof str !== "string") return 0;
  // Strip optional "(NN%)" suffix from Reclaimable values like "3.6GB (66%)"
  const cleaned = str.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = cleaned.match(/^([\d.]+)\s*([kKmMgGtT]?)i?[bB]?$/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mults = {
    "": 1,
    k: 1000,
    m: 1000 ** 2,
    g: 1000 ** 3,
    t: 1000 ** 4,
  };
  return Math.round(num * (mults[unit] || 1));
}

function getDockerUsage() {
  try {
    const output = execSync('docker system df --format "{{json .}}"', {
      encoding: "utf8",
      timeout: 10000,
    });
    const rows = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    return rows.map((r) => ({
      type: r.Type,
      totalCount: r.TotalCount,
      active: r.Active,
      sizeBytes: parseDockerSize(r.Size),
      sizeStr: r.Size,
      reclaimableBytes: parseDockerSize(r.Reclaimable),
      reclaimableStr: r.Reclaimable,
    }));
  } catch {
    return null;
  }
}

function listDockerImages() {
  try {
    const out = execSync(
      'docker image ls --all --format "{{json .}}"',
      { encoding: "utf8", timeout: 10000 }
    );
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((i) => ({
        ref: i.Repository === "<none>" ? `<none>:${i.Tag}` : `${i.Repository}:${i.Tag}`,
        id: i.ID,
        size: parseDockerSize(i.Size),
        sizeStr: i.Size,
      }))
      .sort((a, b) => b.size - a.size);
  } catch {
    return [];
  }
}

function listDockerContainers() {
  try {
    const out = execSync(
      'docker ps --all --size --format "{{json .}}"',
      { encoding: "utf8", timeout: 10000 }
    );
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((c) => {
        // Size looks like "1.2MB (virtual 500MB)" — take the writable layer only
        const sizeStr = (c.Size || "0B").split(" ")[0];
        return {
          name: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status,
          size: parseDockerSize(sizeStr),
          sizeStr,
        };
      })
      .sort((a, b) => b.size - a.size);
  } catch {
    return [];
  }
}

function showDockerResults(usage, dryRun) {
  if (!usage || usage.length === 0) return 0;

  const reclaimableTotal = usage.reduce((s, u) => s + u.reclaimableBytes, 0);
  const usedTotal = usage.reduce((s, u) => s + u.sizeBytes, 0);

  const label = dryRun
    ? `${c.yellow}[DRY RUN]${c.reset} Docker is using`
    : "Docker is using";

  console.log(
    `  ${label} ${c.bold}${formatSize(usedTotal)}${c.reset} ${c.dim}(${c.green}${formatSize(reclaimableTotal)}${c.dim} reclaimable)${c.reset}`
  );
  console.log();

  const typeWidth = Math.max(...usage.map((u) => u.type.length));
  for (const u of usage) {
    const typePad = " ".repeat(Math.max(0, typeWidth - u.type.length));
    console.log(
      `    ${c.blue}${u.type}${c.reset}${typePad}  ` +
        `${c.bold}${u.sizeStr.padStart(10)}${c.reset}  ` +
        `${c.dim}${u.totalCount} total, ${u.active} active${c.reset}  ` +
        `${c.green}${u.reclaimableStr}${c.reset} ${c.dim}reclaimable${c.reset}`
    );
  }
  console.log();

  // Top images
  const images = listDockerImages();
  if (images.length > 0) {
    const top = images.slice(0, 10);
    console.log(`  ${c.bold}Top images${c.reset}`);
    const refWidth = Math.min(50, Math.max(...top.map((i) => i.ref.length)));
    for (const img of top) {
      const ref = img.ref.length > 50 ? img.ref.slice(0, 47) + "..." : img.ref;
      const pad = " ".repeat(Math.max(0, refWidth - ref.length));
      console.log(
        `    ${c.cyan}${ref}${c.reset}${pad}  ${c.bold}${img.sizeStr.padStart(10)}${c.reset}  ${c.dim}${img.id}${c.reset}`
      );
    }
    if (images.length > top.length) {
      console.log(
        `    ${c.dim}… and ${images.length - top.length} more image${images.length - top.length === 1 ? "" : "s"}${c.reset}`
      );
    }
    console.log();
  }

  // Containers
  const containers = listDockerContainers();
  if (containers.length > 0) {
    console.log(`  ${c.bold}Containers${c.reset}`);
    const top = containers.slice(0, 10);
    const nameWidth = Math.min(30, Math.max(...top.map((c) => c.name.length)));
    for (const ct of top) {
      const name = ct.name.length > 30 ? ct.name.slice(0, 27) + "..." : ct.name;
      const pad = " ".repeat(Math.max(0, nameWidth - name.length));
      const stateColor = ct.state === "running" ? c.green : c.dim;
      console.log(
        `    ${c.cyan}${name}${c.reset}${pad}  ${c.bold}${ct.sizeStr.padStart(10)}${c.reset}  ${stateColor}${ct.state}${c.reset}  ${c.dim}${ct.image}${c.reset}`
      );
    }
    if (containers.length > top.length) {
      console.log(
        `    ${c.dim}… and ${containers.length - top.length} more container${containers.length - top.length === 1 ? "" : "s"}${c.reset}`
      );
    }
    console.log();
  }

  return reclaimableTotal;
}

function deleteDocker() {
  console.log(
    `  ${c.cyan}→${c.reset} ${c.dim}docker system prune --all --volumes --force${c.reset}`
  );
  try {
    const output = execSync("docker system prune --all --volumes --force", {
      encoding: "utf8",
      timeout: 600000,
    });
    const m = output.match(/Total reclaimed space:\s*(.+)$/im);
    const reclaimed = m ? m[1].trim() : "unknown amount";
    console.log(
      `  ${c.green}✓${c.reset} Reclaimed ${c.bold}${c.green}${reclaimed}${c.reset} from Docker`
    );
  } catch (err) {
    console.log(
      `  ${c.red}✗${c.reset} Docker cleanup failed: ${err.message.split("\n")[0]}`
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

  // Calculate sizes (with progress)
  if (results.length > 0) {
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
  }

  // Display file artifact results
  showResults(results, targetPath, args.dryRun);

  // Confirm + delete file artifacts
  if (results.length > 0 && !args.dryRun) {
    let proceed = args.yes;
    if (!proceed) {
      const answer = await prompt(
        `  ${c.yellow}?${c.reset} Delete all ${results.length} artifact${results.length === 1 ? "" : "s"}? ${c.dim}(y/N)${c.reset} `
      );
      console.log();
      proceed = answer === "y" || answer === "yes";
    }

    if (proceed) {
      deleteResults(results);
    } else {
      console.log(`  ${c.dim}Skipped file artifact deletion.${c.reset}`);
      console.log();
    }
  }

  // ─── Docker ──────────────────────────────────────────────────────────────
  let dockerUsage = null;
  if (!args.noDocker) {
    if (isTTY) {
      process.stdout.write(`  ${c.dim}Checking Docker...${c.reset}`);
    }
    if (checkDockerAvailable()) {
      dockerUsage = getDockerUsage();
    }
    if (isTTY) {
      process.stdout.write("\r" + " ".repeat(40) + "\r");
    }
  }

  if (dockerUsage && dockerUsage.length > 0) {
    const reclaimable = showDockerResults(dockerUsage, args.dryRun);

    if (!args.dryRun) {
      if (reclaimable <= 0) {
        console.log(
          `  ${c.green}✓${c.reset} Nothing to reclaim from Docker.`
        );
        console.log();
      } else {
        let proceed = args.yes;
        if (!proceed) {
          console.log(
            `  ${c.dim}This removes all stopped containers, all images not in use by a${c.reset}`
          );
          console.log(
            `  ${c.dim}running container, all unused volumes, and all build cache.${c.reset}`
          );
          const answer = await prompt(
            `  ${c.yellow}?${c.reset} Run ${c.bold}docker system prune --all --volumes${c.reset} to free ~${c.bold}${c.green}${formatSize(reclaimable)}${c.reset}? ${c.dim}(y/N)${c.reset} `
          );
          console.log();
          proceed = answer === "y" || answer === "yes";
        }

        if (proceed) {
          deleteDocker();
        } else {
          console.log(`  ${c.dim}Skipped Docker cleanup.${c.reset}`);
          console.log();
        }
      }
    }
  }

  // Dry run reminder at the very end if nothing was deleted
  if (args.dryRun && (results.length > 0 || (dockerUsage && dockerUsage.length > 0))) {
    console.log(
      `  ${c.dim}Run without --dry-run to delete these artifacts${c.reset}`
    );
    console.log();
  }
}

main().catch((err) => {
  console.error(`  ${c.red}Error:${c.reset} ${err.message}`);
  process.exit(1);
});
