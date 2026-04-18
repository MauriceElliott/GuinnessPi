# Extension Utilities Library

Reusable TypeScript utilities extracted from the pi-agent extensions for common patterns.

## Modules

### `config-manager.ts`
JSON config file utilities with error handling and file watching.

**Key functions:**
- `readJsonConfig<T>(path, fallback)` - Read JSON with fallback
- `writeJsonConfig(path, data)` - Write formatted JSON
- `watchJsonConfig(path, callback, fallback, options)` - Watch file for changes (debounced)
- `normalizeHost(host)` - Strip protocol and trailing slash
- `abbreviatePath(fullPath)` - Abbreviate file paths for display
- `formatShortDate(isoDate)` - Format ISO dates (e.g., "May 1")
- `parseGhHosts(yaml)` - Parse hostnames from gh's hosts.yml

**Usage:**
```typescript
import { readJsonConfig, watchJsonConfig } from "../lib";

const config = readJsonConfig(path, { defaultKey: "value" });
watchJsonConfig(path, (newConfig) => {
  console.log("Config changed", newConfig);
}, {}, { debounceMs: 150 });
```

---

### `exec-utils.ts`
Wrappers for executing external commands with consistent error handling.

**Key functions:**
- `execCommand(pi, command, args, options)` - Generic command execution
- `execGit(pi, args, timeout?)` - Execute git commands (auto-trim, throws on error)
- `execGh(pi, args, hostname?, timeout?)` - Execute gh commands (hostname-aware)
- `tryExec(pi, command, args, options)` - Try execution without throwing

**Usage:**
```typescript
import { execGit, execGh } from "../lib";

const branch = await execGit(pi, ["rev-parse", "--abbrev-ref", "HEAD"]);
const userData = await execGh(pi, ["api", "/user"], "github.com");
```

---

### `theme-text-utils.ts`
Theme-aware text rendering with ANSI code handling.

**Key functions:**
- `stripAnsi(s)` - Remove ANSI escape codes
- `getVisibleWidth(s)` - Measure visible width (accounting for codes)
- `truncateToVisibleWidth(s, width)` - Truncate to visible width
- `colorizeText(text, colorKey, theme)` - Apply theme color
- `padToVisibleWidth(text, width, theme)` - Pad to visible width
- `thinkingLevelToColor(level)` - Map thinking level to color
- `percentToColor(percent)` - Map percentage to status color
- `layoutLeftRight(left, right, totalWidth)` - Left/right layout with padding

**Usage:**
```typescript
import { stripAnsi, layoutLeftRight, thinkingLevelToColor } from "../lib";

const clean = stripAnsi(styledText);
const line = layoutLeftRight(leftContent, rightContent, 80);
const color = thinkingLevelToColor("medium");
```

---

### `text-input-component.ts`
Reusable multi-line text input with word-wrapping and cursor tracking.

**Key class:**
- `TextInputComponent` - Implements `Focusable` interface

**Methods:**
- `getValue()` - Get current text
- `setValue(text)` - Set text
- `clear()` - Clear input
- `handleInput(data)` - Process key/character input
- `render(width)` - Render to lines
- `invalidate()` - Mark for re-render
- `dispose()` - Cleanup

**Utility functions:**
- `measureWrappedText(text, width)` - Get wrap metrics
- `wrapTextSimple(text, width)` - Simple text wrapping

**Usage:**
```typescript
import { TextInputComponent } from "../lib";

const input = new TextInputComponent(theme, { placeholder: "Type..." });
input.focused = true;
input.handleInput(keyData);
const lines = input.render(width);
```

---

### `credential-manager.ts`
GitHub host discovery and credential utilities.

**Key functions:**
- `normalizeHost(host)` - Normalize hostname
- `getHostFromCredential(cred)` - Determine host from pi credential
- `discoverGhHosts(path)` - Parse gh CLI hosts.yml
- `discoverCopilotUsers(path)` - Parse Copilot CLI config
- `discoverAuthenticatedHosts(ghPath, copilotPath)` - Find intersection of authenticated hosts
- `rotateNext(items, current, defaultNext?)` - Cycle to next item
- `findCopilotUserByHost(users, host)` - Find user by hostname
- `getAuthSidecarPath(piDir, host)` - Get auth sidecar path
- `getAuthSidecarPaths(piDir, hosts)` - Get all sidecar paths
- `getActiveHostFromSettings(path)` - Determine active host from settings.json

**Usage:**
```typescript
import { discoverAuthenticatedHosts, rotateNext, getAuthSidecarPath } from "../lib";

const { hosts, copilotUsers } = discoverAuthenticatedHosts(ghPath, copilotPath);
const next = rotateNext(hosts, current);
const sidecarPath = getAuthSidecarPath(piDir, host);
```

---

### `async-utils.ts`
Async operation utilities: debouncing, batching, retry, pooling.

**Key functions:**
- `debounce(fn, delayMs)` - Debounce function calls
- `debounceAsync(fn, delayMs)` - Debounce async function calls
- `batchAsync(operations)` - Run parallel async ops with labeled results
- `retry(fn, options)` - Retry with exponential backoff
- `withTimeout(promise, ms, message)` - Race against timeout
- `sequenceAsync(operations)` - Run sequentially (order preserved)
- `poolAsync(operations, concurrency)` - Run with concurrency limit

**Usage:**
```typescript
import { debounceAsync, retry, poolAsync } from "../lib";

const debouncedRefresh = debounceAsync(() => refreshData(), 150);
const result = await retry(() => fetchData(), { maxAttempts: 3 });
const results = await poolAsync([op1, op2, op3], concurrency: 2);
```

---

## Import patterns

### From the lib index
```typescript
import { 
  readJsonConfig, 
  execGit, 
  stripAnsi, 
  TextInputComponent 
} from "../lib";
```

### From specific modules
```typescript
import { readJsonConfig } from "../lib/config-manager";
import { execGit } from "../lib/exec-utils";
```

---

## Design notes

- **Error handling**: Most functions include try/catch with sensible defaults
- **Debouncing**: File watching uses 150ms default debounce to avoid rapid callbacks
- **Type safety**: Full TypeScript support with proper interfaces
- **No external deps**: Uses only built-in Node APIs + pi-coding-agent/pi-tui
- **Extensibility**: All modules export types for custom implementations
