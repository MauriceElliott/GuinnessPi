/**
 * Clear Context Command
 *
 * Registers /clear command to clear the conversation context and start a new session.
 * Similar to /clear in GitHub Copilot.
 *
 * Placement: ~/.pi/agent/extensions/clear-context.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("clear", {
    description: "Clear conversation context and start a new session",
    handler: async (_args, ctx) => {
      await ctx.newSession();
    },
  });
}
