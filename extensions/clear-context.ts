/**
 * Clear Context Command
 *
 * Registers /clear command to clear the conversation context and screen.
 * Similar to /clear in GitHub Copilot.
 *
 * Placement: ~/.pi/agent/extensions/clear-context.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("clear", {
    description: "Clear conversation context and screen",
    handler: async () => {
      // Send message to clear context
      pi
      pi.sendUserMessage("", { deliverAs: "clear" });
      console.clear();
    },
  });
}
