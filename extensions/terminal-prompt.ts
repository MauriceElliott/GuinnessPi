/**
 * Terminal Prompt Footer + Editor
 *
 * Footer (1 line):
 *   π ~/r/project > claude-sonnet-4.6 - medium >  ⑂ main *2          ◆ 215/300  72%  ↺ May 1
 *
 * Editor (no box, ↪ prefix):
 *   ↪ this is my prompt.
 *
 * Placement: ~/.pi/agent/extensions/terminal-prompt.ts
 */

import { CustomEditor, type ExtensionAPI, type Theme, type ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";
import type { KeybindingsManager } from "@mariozechner/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuotaSnapshot {
  remaining: number;
  entitlement: number;
  percent_remaining: number;
  unlimited: boolean;
}

interface CopilotUserData {
  quota_reset_date_utc: string;
  quota_snapshots: { premium_interactions: QuotaSnapshot };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROMPT_GLYPH = "↪ "; // 2 visual columns
const PROMPT_WIDTH = 2;

/** ~/repos/my-project  →  ~/r/my-project */
function abbreviatePath(fullPath: string): string {
  const home = process.env.HOME ?? "";
  const rel =
    home && fullPath.startsWith(home)
      ? "~" + fullPath.slice(home.length)
      : fullPath;
  const parts = rel.split("/").filter(Boolean);
  if (parts.length <= 2) return rel;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const middle = parts.slice(1, -1).map((p) => p[0] ?? p);
  const prefix = rel.startsWith("/") && !rel.startsWith("~") ? "/" : "";
  return prefix + [first, ...middle, last].join("/");
}

function formatResetDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function thinkingColor(level: string): ThemeColor {
  const map: Record<string, ThemeColor> = {
    off: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXhigh",
  };
  return map[level] ?? "dim";
}

/** Strip ANSI escape codes to measure visual width */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_.*?\x1b\\/g, "");
}

// ─── Custom Editor ────────────────────────────────────────────────────────────

class TerminalPromptEditor extends CustomEditor {
  private getTheme: () => Theme;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    getTheme: () => Theme
  ) {
    // paddingX: 0 — no side padding, we handle prefix ourselves
    super(tui, editorTheme, keybindings, { paddingX: 0 });
    this.getTheme = getTheme;
  }

  render(width: number): string[] {
    // Render at reduced width so our prefix fits exactly
    const raw = super.render(width - PROMPT_WIDTH);

    // raw structure (from Editor source):
    //   [0]           top border  (─────... or scroll indicator)
    //   [1 .. n-1]    content lines
    //   [n]           bottom border (─────... or scroll indicator)
    //   [n+1 ...]     autocomplete lines (optional)
    //
    // Detect bottom border: scan back for first line whose stripped text starts with ─
    let bottomIdx = raw.length - 1;
    for (let i = raw.length - 1; i >= 1; i--) {
      if (stripAnsi(raw[i]!).startsWith("─")) {
        bottomIdx = i;
        break;
      }
    }

    const theme = this.getTheme();
    const promptStr = theme.fg("accent", PROMPT_GLYPH);
    const indent = " ".repeat(PROMPT_WIDTH);

    const result: string[] = [];

    // Content lines (skip top border, skip bottom border)
    const contentLines = raw.slice(1, bottomIdx);
    for (let i = 0; i < contentLines.length; i++) {
      result.push((i === 0 ? promptStr : indent) + contentLines[i]!);
    }

    // Autocomplete lines — keep them, shifted right by PROMPT_WIDTH
    for (const line of raw.slice(bottomIdx + 1)) {
      result.push(indent + line);
    }

    return result;
  }
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let quotaData: CopilotUserData | null = null;
  let gitDirtyCount = 0;
  let gitBranch: string | null = null;
  let tuiRef: { requestRender(): void } | null = null;
  let cwdCache = "";

  async function fetchQuota(): Promise<void> {
    try {
      const r = await pi.exec("gh", ["api", "/copilot_internal/user"], { timeout: 8000 });
      quotaData = r.code === 0 ? (JSON.parse(r.stdout) as CopilotUserData) : null;
    } catch {
      quotaData = null;
    }
  }

  async function fetchGitBranch(): Promise<void> {
    try {
      const r = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 });
      gitBranch = r.code === 0 ? r.stdout.trim() : null;
    } catch {
      gitBranch = null;
    }
  }

  async function fetchGitDirty(): Promise<void> {
    try {
      const r = await pi.exec("git", ["status", "--porcelain"], { timeout: 3000 });
      gitDirtyCount =
        r.code === 0 ? r.stdout.trim().split("\n").filter(Boolean).length : 0;
    } catch {
      gitDirtyCount = 0;
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([fetchQuota(), fetchGitDirty(), fetchGitBranch()]);
    tuiRef?.requestRender();
  }

  function buildStatusLine(
    width: number,
    theme: Theme,
    branch: string | null,
    model: { id: string } | null | undefined
  ): string {
    const level = pi.getThinkingLevel();
    const sep = theme.fg("muted", " > ");

    // ── left ──
    const piGlyph = theme.fg("accent", "π");
    const cwd = theme.fg("dim", ` ${abbreviatePath(cwdCache)}`);
    const modelId = theme.fg("text", model?.id ?? "no model");
    const dash = theme.fg("dim", " - ");
    const levelStr = theme.fg(thinkingColor(level), level);

    let left = piGlyph + cwd + sep + modelId + dash + levelStr;

    if (branch) {
      const branchStr = theme.fg("accent", `⑂ ${branch}`);
      const dirty =
        gitDirtyCount > 0 ? theme.fg("warning", ` *${gitDirtyCount}`) : "";
      left += sep + branchStr + dirty;
    }

    // ── right ──
    let right = "";
    if (quotaData) {
      const snap = quotaData.quota_snapshots.premium_interactions;
      if (!snap.unlimited) {
        const pct = snap.percent_remaining;
        const countColor: ThemeColor =
          pct > 50 ? "success" : pct > 25 ? "warning" : "error";
        right =
          theme.fg("dim", "◆ ") +
          theme.fg(countColor, `${snap.remaining}/${snap.entitlement}`) +
          theme.fg("dim", `  ${Math.round(pct)}%`) +
          theme.fg("dim", `  ↺ ${formatResetDate(quotaData.quota_reset_date_utc)}`);
      }
    }

    const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return truncateToWidth(left + " ".repeat(pad) + right, width);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    cwdCache = ctx.cwd;
    await refreshAll();

    // ── Status bar: above the editor ──
    ctx.ui.setWidget("terminal-status", (tui, theme) => {
      tuiRef = tui;
      return {
        invalidate() {},
        render(width: number): string[] {
          return [buildStatusLine(width, theme, gitBranch, ctx.model)];
        },
      };
    }, { placement: "aboveEditor" });

    // ── Footer: blank (clears the default status bar) ──
    ctx.ui.setFooter((_tui, _theme, _footerData) => ({
      invalidate() {},
      render(_width: number): string[] { return []; },
    }));

    // ── Editor: borderless with ↪ prefix ──
    ctx.ui.setEditorComponent((tui, editorTheme, kb) => {
      return new TerminalPromptEditor(tui, editorTheme, kb, () => ctx.ui.theme);
    });
  });

  pi.on("model_select", () => {
    tuiRef?.requestRender();
  });

  pi.on("agent_end", async () => {
    await refreshAll();
  });
}
