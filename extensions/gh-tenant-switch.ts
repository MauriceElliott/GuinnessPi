/**
 * GitHub Account Switcher
 *
 * Registers /switch-account. Discovers available accounts dynamically from
 * ~/.config/gh/hosts.yml (gh CLI) and ~/.copilot/config.json (Copilot CLI),
 * cycles through the intersection, and keeps settings.json,
 * ~/.copilot/config.json, and ~/.pi/agent/auth.json all in sync.
 *
 * Credentials are stored as sidecars alongside auth.json:
 *   ~/.pi/agent/auth.github.com.json
 *   ~/.pi/agent/auth.kb-tech.ghe.com.json   ← etc. for any host
 *
 * auth.json is always the active credential. On each switch the current
 * credential is saved to its sidecar and the target sidecar is loaded into
 * auth.json. Auth changes take effect on next pi session start.
 *
 * The command reads auth.json directly to determine the actual current host
 * (via the enterpriseUrl field inside the credential) rather than trusting
 * settings.json. This means it self-corrects if pi's own login flow has
 * overwritten auth.json without our knowledge.
 *
 * Placement: ~/.pi/agent/extensions/gh-tenant-switch.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CopilotUser {
  host: string;
  login: string;
}

interface CopilotConfig {
  loggedInUsers?: CopilotUser[];
  lastLoggedInUser?: CopilotUser;
  [key: string]: unknown;
}

interface PiCredential {
  type?: string;
  refresh: string;
  access: string;
  expires: number;
  enterpriseUrl?: string | null;
}

interface PiAuthStore {
  "github-copilot"?: PiCredential;
  [key: string]: unknown;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME ?? "";
const piDir = join(HOME, ".pi/agent");
const settingsPath = join(piDir, "settings.json");
const authPath = join(piDir, "auth.json");
const ghHostsPath = join(HOME, ".config/gh/hosts.yml");
const copilotConfigPath = join(HOME, ".copilot/config.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip protocol and trailing slash: https://github.com/ → github.com */
function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Parse top-level hostname keys from gh's hosts.yml.
 * Top-level keys have no leading whitespace, end with ":", and look like
 * a hostname (contain at least one dot with a valid TLD-ish segment).
 */
function parseGhHosts(yaml: string): string[] {
  return yaml
    .split("\n")
    .filter(line => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.[a-zA-Z]{2,}:\s*$/.test(line))
    .map(line => line.trim().slice(0, -1));
}

/**
 * Determine which GitHub host a pi credential belongs to.
 * Absence of enterpriseUrl means github.com (the default).
 */
function getHostFromCredential(cred: PiCredential): string {
  return cred.enterpriseUrl ? normalizeHost(cred.enterpriseUrl) : "github.com";
}

/** Path to the auth sidecar file for a given hostname. */
function authSidecarPath(host: string): string {
  return join(piDir, `auth.${host}.json`);
}

/**
 * Discover hosts that are authenticated in both the gh CLI and the Copilot
 * CLI. These are the only hosts we can meaningfully switch between.
 */
function discoverSwitchableAccounts(): { hosts: string[]; copilotUsers: CopilotUser[] } {
  let ghHosts: string[] = [];
  try {
    ghHosts = parseGhHosts(readFileSync(ghHostsPath, "utf-8"));
  } catch { /* gh not configured */ }

  let copilotUsers: CopilotUser[] = [];
  try {
    const config = JSON.parse(readFileSync(copilotConfigPath, "utf-8")) as CopilotConfig;
    copilotUsers = config.loggedInUsers ?? [];
  } catch { /* copilot not configured */ }

  const copilotHostSet = new Set(copilotUsers.map(u => normalizeHost(u.host)));
  const hosts = ghHosts.filter(h => copilotHostSet.has(h));

  return { hosts, copilotUsers };
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("switch-account", {
    description: "Cycle active GitHub account (gh CLI + Copilot CLI + pi auth)",
    handler: async () => {
      const { hosts, copilotUsers } = discoverSwitchableAccounts();

      if (hosts.length < 2) {
        console.log("[switch-account] fewer than 2 accounts discovered — nothing to switch");
        return;
      }

      // ── Read auth.json and detect actual current host ─────────────────────
      // We read the credential directly rather than trusting settings.json,
      // so this self-corrects if pi's login flow has overwritten auth.json.
      let authStore: PiAuthStore;
      try {
        authStore = JSON.parse(readFileSync(authPath, "utf-8")) as PiAuthStore;
      } catch {
        console.log("[switch-account] could not read auth.json");
        return;
      }

      const credential = authStore["github-copilot"];
      if (!credential) {
        console.log("[switch-account] no github-copilot credential in auth.json");
        return;
      }

      const actualCurrentHost = getHostFromCredential(credential);

      // ── Save current auth.json to its sidecar ─────────────────────────────
      try {
        writeFileSync(
          authSidecarPath(actualCurrentHost),
          JSON.stringify(authStore, null, 2) + "\n"
        );
      } catch {
        console.log(`[switch-account] could not save sidecar for ${actualCurrentHost}`);
        return;
      }

      // ── Determine next host ───────────────────────────────────────────────
      const currentIndex = hosts.indexOf(actualCurrentHost);
      const nextIndex = (currentIndex + 1) % hosts.length;
      const nextHost = hosts[nextIndex]!;
      const sidecar = authSidecarPath(nextHost);

      // ── Check sidecar exists for next host ────────────────────────────────
      if (!existsSync(sidecar)) {
        // Keep settings in sync with where we actually are, then bail.
        try {
          const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
          s.activeGhHost = actualCurrentHost;
          delete s.ghTenant;
          writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n");
        } catch { /* ignore */ }
        console.log(
          `[switch-account] no credentials found for ${nextHost} — ` +
          `log into that account via pi's login command, then run /switch-account again`
        );
        return;
      }

      // ── Load next host's sidecar into auth.json ───────────────────────────
      try {
        writeFileSync(authPath, readFileSync(sidecar, "utf-8"));
      } catch {
        console.log(`[switch-account] could not load credentials for ${nextHost}`);
        return;
      }

      // ── Update settings.json ──────────────────────────────────────────────
      try {
        const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
        s.activeGhHost = nextHost;
        delete s.ghTenant;
        writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n");
      } catch { /* ignore */ }

      // ── Update ~/.copilot/config.json lastLoggedInUser ────────────────────
      try {
        const config = JSON.parse(readFileSync(copilotConfigPath, "utf-8")) as CopilotConfig;
        const nextUser = copilotUsers.find(u => normalizeHost(u.host) === nextHost);
        if (nextUser) {
          config.lastLoggedInUser = nextUser;
          writeFileSync(copilotConfigPath, JSON.stringify(config, null, 2) + "\n");
        }
      } catch { /* ignore */ }

      console.log(`[switch-account] switched to ${nextHost} — restart pi for auth to take effect`);
    },
  });
}
