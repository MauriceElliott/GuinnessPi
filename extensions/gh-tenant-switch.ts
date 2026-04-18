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
 *   ~/.pi/agent/auth.company.ghe.com.json   ← etc. for any host
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
import {
  readJsonConfig,
  writeJsonConfig,
  discoverAuthenticatedHosts,
  getHostFromCredential,
  getAuthSidecarPath,
  normalizeHost,
  findCopilotUserByHost,
  rotateNext,
} from "../lib";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("switch-account", {
    description: "Cycle active GitHub account (gh CLI + Copilot CLI + pi auth)",
    handler: async () => {
      const { hosts, copilotUsers } = discoverAuthenticatedHosts(
        ghHostsPath,
        copilotConfigPath
      );

      if (hosts.length < 2) {
        console.log("[switch-account] fewer than 2 accounts discovered — nothing to switch");
        return;
      }

      // ── Read auth.json and detect actual current host ─────────────────────
      // We read the credential directly rather than trusting settings.json,
      // so this self-corrects if pi's login flow has overwritten auth.json.
      const authStore = readJsonConfig<PiAuthStore>(authPath, {});
      const credential = authStore["github-copilot"];

      if (!credential) {
        console.log("[switch-account] no github-copilot credential in auth.json");
        return;
      }

      const actualCurrentHost = getHostFromCredential(credential);

      // ── Save current auth.json to its sidecar ─────────────────────────────
      try {
        writeFileSync(
          getAuthSidecarPath(piDir, actualCurrentHost),
          JSON.stringify(authStore, null, 2) + "\n"
        );
      } catch {
        console.log(`[switch-account] could not save sidecar for ${actualCurrentHost}`);
        return;
      }

      // ── Determine next host ───────────────────────────────────────────────
      const nextHost = rotateNext(hosts, actualCurrentHost);
      if (!nextHost) {
        console.log("[switch-account] could not determine next host");
        return;
      }

      const sidecar = getAuthSidecarPath(piDir, nextHost);

      // ── Check sidecar exists for next host ────────────────────────────────
      if (!existsSync(sidecar)) {
        // Keep settings in sync with where we actually are, then bail.
        try {
          const s = readJsonConfig<Record<string, unknown>>(settingsPath, {});
          s.activeGhHost = actualCurrentHost;
          delete s.ghTenant;
          writeJsonConfig(settingsPath, s);
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
        const s = readJsonConfig<Record<string, unknown>>(settingsPath, {});
        s.activeGhHost = nextHost;
        delete s.ghTenant;
        writeJsonConfig(settingsPath, s);
      } catch { /* ignore */ }

      // ── Update ~/.copilot/config.json lastLoggedInUser ────────────────────
      try {
        const config = readJsonConfig<Record<string, unknown>>(
          copilotConfigPath,
          {}
        );
        const nextUser = findCopilotUserByHost(copilotUsers, nextHost);
        if (nextUser) {
          config.lastLoggedInUser = nextUser;
          writeJsonConfig(copilotConfigPath, config);
        }
      } catch { /* ignore */ }

      console.log(`[switch-account] switched to ${nextHost} — restart pi for auth to take effect`);
    },
  });
}
