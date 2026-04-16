/**
 * Approval Gate Extension
 *
 * Intercepts mutating tool calls (write, edit, non-read-only bash) and
 * presents an overlay dialog with three options:
 *
 *   Yes            – approve as-is
 *   Yes, and...    – approve + send a steering instruction
 *   No, and...     – block  + send an alternative instruction
 *
 * Read-only tools (read, ls, grep, find) and read-only bash commands
 * pass through without prompting.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// ── Result type ───────────────────────────────────────────────────────────────

type ApprovalResult =
	| { action: "approve" }
	| { action: "approve_instruct"; instruction: string }
	| { action: "reject_instruct"; instruction: string }
	| { action: "cancel" };

// ── Read-only classification ──────────────────────────────────────────────────

const SAFE_COMMANDS = new Set([
	// File reading
	"cat", "head", "tail", "less", "more", "bat", "tac",
	// Listing / finding
	"ls", "tree", "find", "locate", "fd",
	// Search
	"grep", "egrep", "fgrep", "rg", "ag", "ack",
	// File info
	"file", "stat", "wc", "du", "df", "md5sum", "sha256sum", "sha1sum",
	// Text processing (stdout-only)
	"sort", "uniq", "cut", "tr", "awk", "sed", "jq", "yq", "column", "fmt", "fold", "nl", "rev",
	// Path utilities
	"which", "whereis", "type", "command", "realpath", "readlink", "basename", "dirname",
	// System info
	"echo", "printf", "pwd", "date", "cal", "whoami", "id", "hostname", "uname", "uptime",
	"env", "printenv", "ps", "free", "lsof",
	// Comparison
	"diff", "cmp", "comm",
	// Test
	"test", "[", "[[", "true", "false",
	// Network (read)
	"dig", "host", "nslookup", "ping",
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
	"status", "log", "diff", "show", "branch", "tag", "remote",
	"describe", "rev-parse", "ls-files", "blame", "shortlog", "reflog",
]);

function firstWord(segment: string): string {
	const parts = segment.split(/\s+/);
	for (const p of parts) {
		if (p.includes("=") && !p.startsWith("-")) continue; // skip FOO=bar
		return p.split("/").pop() || p; // handle /usr/bin/cat → cat
	}
	return parts[0]?.split("/").pop() || "";
}

function secondWord(segment: string): string | undefined {
	const parts = segment.split(/\s+/).filter((p) => !p.includes("=") || p.startsWith("-"));
	return parts[1];
}

function isReadOnlyBash(command: string): boolean {
	// Any file redirect → mutating
	if (command.includes(">")) return false;
	// sed -i → mutating
	if (/\bsed\b.*\s-i\b/.test(command)) return false;

	const segments = command
		.split(/\s*(?:&&|\|\||[;\n|])\s*/)
		.map((s) => s.trim())
		.filter(Boolean);

	for (const seg of segments) {
		const cmd = firstWord(seg);
		if (!cmd) continue;

		if (cmd === "git") {
			const sub = secondWord(seg);
			if (!sub || !SAFE_GIT_SUBCOMMANDS.has(sub)) return false;
			continue;
		}

		if (!SAFE_COMMANDS.has(cmd)) return false;
	}

	return true;
}

// ── Tool call description ─────────────────────────────────────────────────────

function describeToolCall(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash") {
		const cmd = String(input.command ?? "");
		const first = cmd.split("\n")[0]?.trim() ?? cmd;
		return `bash  ${first}`;
	}
	if (toolName === "edit") return `edit  ${input.path}`;
	if (toolName === "write") return `write  ${input.path}`;
	return `${toolName}  ${JSON.stringify(input).slice(0, 80)}`;
}

// ── Approval dialog component ─────────────────────────────────────────────────

const OPTIONS = ["Yes", "Yes, and...", "No, and..."] as const;

class ApprovalDialog implements Focusable {
	focused = false;

	private mode: "select" | "typing" = "select";
	private selected = 0;
	private inputBuffer = "";
	private inputCursor = 0;
	private description: string;
	private theme: Theme;
	private done: (r: ApprovalResult) => void;

	constructor(theme: Theme, description: string, done: (r: ApprovalResult) => void) {
		this.theme = theme;
		this.description = description;
		this.done = done;
	}

	// ── Input ───────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.mode === "select") {
			this.handleSelect(data);
		} else {
			this.handleTyping(data);
		}
	}

	private handleSelect(data: string): void {
		if (matchesKey(data, "up") && this.selected > 0) {
			this.selected--;
		} else if (matchesKey(data, "down") && this.selected < 2) {
			this.selected++;
		} else if (matchesKey(data, "return")) {
			if (this.selected === 0) {
				this.done({ action: "approve" });
				return;
			}
			this.mode = "typing";
			this.inputBuffer = "";
			this.inputCursor = 0;
		} else if (matchesKey(data, "escape")) {
			this.done({ action: "cancel" });
			return;
		} else {
			return;
		}
		this.invalidate();
	}

	private handleTyping(data: string): void {
		if (matchesKey(data, "return")) {
			if (!this.inputBuffer.trim()) return; // require non-empty
			if (this.selected === 1) {
				this.done({ action: "approve_instruct", instruction: this.inputBuffer.trim() });
			} else {
				this.done({ action: "reject_instruct", instruction: this.inputBuffer.trim() });
			}
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "select";
			this.inputBuffer = "";
			this.inputCursor = 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, "backspace")) {
			if (this.inputCursor > 0) {
				this.inputBuffer =
					this.inputBuffer.slice(0, this.inputCursor - 1) + this.inputBuffer.slice(this.inputCursor);
				this.inputCursor--;
			}
		} else if (matchesKey(data, "left")) {
			this.inputCursor = Math.max(0, this.inputCursor - 1);
		} else if (matchesKey(data, "right")) {
			this.inputCursor = Math.min(this.inputBuffer.length, this.inputCursor + 1);
		} else if (data.length >= 1 && data.charCodeAt(0) >= 32 && !data.startsWith("\x1b")) {
			// Printable text (handles paste too)
			this.inputBuffer =
				this.inputBuffer.slice(0, this.inputCursor) + data + this.inputBuffer.slice(this.inputCursor);
			this.inputCursor += data.length;
		} else {
			return;
		}
		this.invalidate();
	}

	// ── Render ──────────────────────────────────────────────────────────────

	private cachedWidth?: number;
	private cachedLines?: string[];

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const t = this.theme;
		const innerW = width - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};
		const row = (content: string) => t.fg("border", "│") + pad(content, innerW) + t.fg("border", "│");

		// ── Top border with title ──
		const title = " Approval Required ";
		const borderLeft = Math.max(0, Math.floor((innerW - title.length) / 2));
		const borderRight = Math.max(0, innerW - borderLeft - title.length);
		lines.push(
			t.fg("border", "╭") +
				t.fg("border", "─".repeat(borderLeft)) +
				t.fg("accent", title) +
				t.fg("border", "─".repeat(borderRight)) +
				t.fg("border", "╮"),
		);

		// ── Tool description ──
		lines.push(row(""));
		lines.push(row("  " + truncateToWidth(t.fg("toolTitle", this.description), innerW - 4)));
		lines.push(row(""));

		// ── Options ──
		if (this.mode === "select") {
			for (let i = 0; i < OPTIONS.length; i++) {
				const isSel = i === this.selected;
				const prefix = isSel ? t.fg("accent", "  ▶ ") : "    ";
				const label = isSel ? t.fg("accent", OPTIONS[i]) : t.fg("text", OPTIONS[i]);
				lines.push(row(prefix + label));
			}
		} else {
			for (let i = 0; i < OPTIONS.length; i++) {
				if (i === this.selected) {
					// Active input line
					const label = i === 1 ? "Yes, and " : "No, and ";
					const prefix = t.fg("accent", "  ↪ " + label);

					if (this.inputBuffer.length === 0) {
						const placeholder = t.fg("dim", "type instruction...");
						const marker = this.focused ? CURSOR_MARKER : "";
						const cursor = `${marker}\x1b[7m \x1b[27m`;
						lines.push(row(prefix + cursor + placeholder));
					} else {
						const before = this.inputBuffer.slice(0, this.inputCursor);
						const cursorChar =
							this.inputCursor < this.inputBuffer.length
								? this.inputBuffer[this.inputCursor]!
								: " ";
						const after = this.inputBuffer.slice(this.inputCursor + 1);
						const marker = this.focused ? CURSOR_MARKER : "";
						const display =
							t.fg("text", before) +
							`${marker}\x1b[7m${cursorChar}\x1b[27m` +
							t.fg("text", after);
						lines.push(row(prefix + display));
					}
				} else {
					lines.push(row("    " + t.fg("dim", OPTIONS[i])));
				}
			}
		}

		// ── Help line ──
		lines.push(row(""));
		const help =
			this.mode === "select"
				? "↑↓ navigate • enter select • esc block"
				: "enter confirm • esc back";
		lines.push(row("  " + t.fg("dim", help)));

		// ── Bottom border ──
		lines.push(t.fg("border", "╰" + "─".repeat(innerW) + "╯"));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	dispose(): void {}
}

// ── System prompt snippet ─────────────────────────────────────────────────────

const GATE_PROMPT = `
## Approval Gate (Active)

Mutating tool calls (write, edit, non-read-only bash) require user approval before execution.
The approval gate handles confirmation automatically — do not ask "should I proceed?" in your
messages. Just make the tool call and the user will approve, reject, or redirect via the gate.

If a tool call is rejected with instructions, follow the user's alternative direction.
If a tool call is approved with additional instructions, execute the tool and then follow those
instructions afterward.
`.trim();

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Gate mutating tool calls ──

	pi.on("tool_call", async (event, ctx) => {
		// Always allow read-only tools
		if (["read", "ls", "grep", "find"].includes(event.toolName)) return undefined;

		// Allow read-only bash
		if (event.toolName === "bash") {
			const cmd = (event.input as { command?: string }).command ?? "";
			if (isReadOnlyBash(cmd)) return undefined;
		}

		// Non-interactive mode: block by default
		if (!ctx.hasUI) {
			return { block: true, reason: "Mutating tool call blocked (no UI for approval)" };
		}

		// Build description
		const desc = describeToolCall(event.toolName, event.input as Record<string, unknown>);

		// Show approval dialog
		const result = await ctx.ui.custom<ApprovalResult>(
			(_tui, theme, _kb, done) => new ApprovalDialog(theme, desc, done),
			{ overlay: true },
		);

		if (!result || result.action === "cancel") {
			return { block: true, reason: "Blocked by user" };
		}

		if (result.action === "approve") {
			return undefined;
		}

		if (result.action === "approve_instruct") {
			pi.sendUserMessage(result.instruction, { deliverAs: "steer" });
			return undefined;
		}

		if (result.action === "reject_instruct") {
			pi.sendUserMessage(result.instruction, { deliverAs: "steer" });
			return { block: true, reason: "Rejected by user" };
		}

		return undefined;
	});

	// ── Inject gate instructions into system prompt ──

	pi.on("before_agent_start", async (event, _ctx) => {
		return { systemPrompt: event.systemPrompt + "\n\n" + GATE_PROMPT };
	});
}
