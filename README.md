# free-dev-space

Instantly free up gigabytes of disk space by cleaning regenerable dev artifacts.

```
npx free-dev-space ~/dev
```

## What it cleans

| Artifact | Context | Safety |
|----------|---------|--------|
| `node_modules` | Anywhere | Direct match |
| `Pods` | Inside `ios/` | Parent check |
| `.next` | Anywhere | Direct match |
| `.nuxt` | Anywhere | Direct match |
| `.gradle` | Inside `android/` | Parent check |
| `build` | Inside `android/app/` | Parent path check |
| `.cxx` | Inside `android/app/` | Parent path check |
| `dist` | Anywhere | Direct match |
| `vendor` | Anywhere | Sibling `Gemfile` |
| `.build` | Anywhere | Direct match |
| `target` | Anywhere | Sibling `Cargo.toml` |
| `__pycache__` | Anywhere | Direct match |
| `.venv` / `venv` | Anywhere | Direct match |
| `.dart_tool` | Anywhere | Direct match |
| `.turbo` | Anywhere | Direct match |
| `.parcel-cache` | Anywhere | Direct match |

## Usage

```
npx free-dev-space [path] [options]
```

### Options

```
-d, --dry-run    Preview what would be deleted
-y, --yes        Skip confirmation prompt
-v, --version    Show version
-h, --help       Show help
```

### Examples

```bash
# Scan current directory
npx free-dev-space .

# Preview without deleting
npx free-dev-space ~/dev --dry-run

# Skip confirmation
npx free-dev-space ~/projects -y
```

## Safety

- Ambiguous directories (`target`, `vendor`) require sibling file checks (`Cargo.toml`, `Gemfile`)
- Platform-specific dirs (`Pods`, `.gradle`, `build`, `.cxx`) require parent directory validation
- Interactive confirmation before deletion (skip with `--yes`)
- `--dry-run` mode to preview
- Never recurses into matched directories
- Respects `NO_COLOR` and non-TTY environments

## Requirements

Node.js >= 18.17

## License

MIT
