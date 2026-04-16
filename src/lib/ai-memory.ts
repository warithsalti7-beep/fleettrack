/**
 * Conversation + long-term memory for the fleet assistant.
 *
 * A "principal" identifies the subject we're remembering — web users
 * use "user:<cuid>", Telegram chats use "tg:<chatId>". Tying memory to
 * a principal (not a session) means a user opening a fresh chat on a
 * new device still sees their history and facts.
 *
 * Two storage layers:
 *   AiMessage  — raw turn log, windowed to the last ~40 turns for context
 *   AiMemory   — distilled key/value facts, loaded into every system prompt
 */

import { prisma } from "./prisma";
import type { ClaudeMessage, ClaudeContentBlock } from "./anthropic";
import { callClaude } from "./anthropic";

const HISTORY_TURNS = 40; // roughly 20 user + 20 assistant turns
const MEMORY_SUMMARY_MODEL = "claude-haiku-4-5";

export type Principal = `user:${string}` | `tg:${string}`;

export function webPrincipal(userId: string): Principal {
  return `user:${userId}`;
}
export function telegramPrincipal(chatId: number | string): Principal {
  return `tg:${chatId}`;
}

/** Pull the last N turns for a principal, oldest-first, ready for Anthropic. */
export async function loadRecentMessages(
  principal: Principal,
  limit = HISTORY_TURNS,
): Promise<ClaudeMessage[]> {
  const rows = await prisma.aiMessage.findMany({
    where: { principal, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

export async function appendUserMessage(
  principal: Principal,
  channel: string,
  text: string,
) {
  await prisma.aiMessage.create({
    data: { principal, channel, role: "user", content: text },
  });
}

export async function appendAssistantMessage(
  principal: Principal,
  channel: string,
  text: string,
  blocks?: ClaudeContentBlock[],
) {
  const toolUse = blocks?.find((b) => b.type === "tool_use");
  await prisma.aiMessage.create({
    data: {
      principal,
      channel,
      role: "assistant",
      content: text,
      toolName: toolUse?.type === "tool_use" ? toolUse.name : null,
      toolInput:
        toolUse?.type === "tool_use"
          ? (toolUse.input as object)
          : undefined,
    },
  });
}

export async function appendToolResult(
  principal: Principal,
  channel: string,
  toolName: string,
  input: unknown,
  output: unknown,
) {
  await prisma.aiMessage.create({
    data: {
      principal,
      channel,
      role: "tool",
      content: typeof output === "string" ? output : JSON.stringify(output),
      toolName,
      toolInput: input as object,
      toolOutput: output as object,
    },
  });
}

/** Load long-term facts as a compact string to splice into the system prompt. */
export async function loadMemoryBlock(principal: Principal): Promise<string> {
  const facts = await prisma.aiMemory.findMany({
    where: { principal },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
  return `Known facts about this user (persisted across sessions):\n${lines}`;
}

export async function upsertMemory(
  principal: Principal,
  key: string,
  value: string,
) {
  await prisma.aiMemory.upsert({
    where: { principal_key: { principal, key } },
    create: { principal, key, value },
    update: { value },
  });
}

/**
 * After an exchange, ask a cheap model to distill any stable new facts
 * about the user and upsert them. Runs fire-and-forget from the route —
 * failures here should never bubble up to the chat response.
 */
export async function distillMemory(
  principal: Principal,
  lastUserText: string,
  lastAssistantText: string,
) {
  try {
    const existing = await loadMemoryBlock(principal);
    const raw = await callClaude(
      [
        {
          role: "user",
          content:
            `Existing facts:\n${existing || "(none)"}\n\n` +
            `Latest exchange:\nUSER: ${lastUserText}\nASSISTANT: ${lastAssistantText}\n\n` +
            `List ONLY new durable facts about the user, their preferences, ` +
            `the vehicles they care about, or their reporting habits. ` +
            `Skip one-off requests. Return JSON: {"facts":[{"key":"snake_case","value":"short"}]}. ` +
            `Return {"facts":[]} if nothing noteworthy.`,
        },
      ],
      {
        model: MEMORY_SUMMARY_MODEL,
        json: true,
        maxTokens: 300,
        temperature: 0,
      },
    );
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\n?|```$/g, "")) as {
      facts?: Array<{ key: string; value: string }>;
    };
    for (const f of parsed.facts ?? []) {
      if (!f.key || !f.value) continue;
      await upsertMemory(principal, f.key.slice(0, 60), f.value.slice(0, 500));
    }
  } catch {
    // Memory distillation is best-effort; never break the user's turn for it.
  }
}
