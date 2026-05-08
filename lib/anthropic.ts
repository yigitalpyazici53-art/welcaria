import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompt";
import { sanitizeSmsText } from "./sanitize";
import type { ConversationState } from "./conversationState";

// Lazy-initialized so the module can be imported before env vars are loaded
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function generateSmsReply(
  customerMessage: string,
  state: ConversationState
): Promise<string> {
  console.log("[Reply] generating (Claude)");

  // Include recent conversation history for multi-turn context (last 6 turns)
  const messages: Anthropic.Messages.MessageParam[] = [
    ...state.history.slice(-6).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: customerMessage },
  ];

  const response = await getClient().messages.create({
    model: "claude-opus-4-7",
    max_tokens: 256,
    system: buildSystemPrompt(state),
    messages,
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text"
  );
  const raw = textBlock ? textBlock.text.trim() : "";

  // Sanitize now so the value stored in history is already clean ASCII ≤120 chars.
  // sendSms() will sanitize again, which is a no-op on already-clean text.
  const clean = sanitizeSmsText(raw);

  console.log("[Reply] generated (Claude):", clean);
  return clean;
}
