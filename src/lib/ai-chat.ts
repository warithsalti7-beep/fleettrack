/**
 * Drives a single user turn through Claude, handling the tool-use loop
 * and persisting history + long-term memory. Used by both the /api/ai/chat
 * route (web) and the Telegram webhook.
 *
 * Confirmation flow for writes:
 *   turn 1: user asks → model emits tool_use (write) → runTool() parks
 *           a PendingAction and returns { type: "pending", summary }
 *           → we surface the summary and ask the user to confirm.
 *   turn 2: user says "yes/confirm" → route intercepts BEFORE calling
 *           the LLM, executes confirmPendingAction, appends a tool msg,
 *           and returns the result to the user.
 */

import {
  callClaudeRaw,
  CHAT_MODEL,
  type ClaudeMessage,
  type ClaudeContentBlock,
  type ClaudeToolUseBlock,
} from "./anthropic";
import {
  loadRecentMessages,
  loadMemoryBlock,
  appendUserMessage,
  appendAssistantMessage,
  appendToolResult,
  upsertMemory,
  distillMemory,
  type Principal,
} from "./ai-memory";
import {
  toolDefinitions,
  runTool,
  confirmPendingAction,
  cancelPendingAction,
  currentPendingSummary,
} from "./ai-tools";

const MAX_TOOL_ITERATIONS = 5;

const CONFIRM_PATTERN = /^\s*(yes|y|confirm|do it|go ahead|ok|okay|sure|please do|proceed)\b/i;
const CANCEL_PATTERN = /^\s*(no|n|cancel|stop|abort|nevermind|never mind)\b/i;

const BASE_SYSTEM = `You are the fleet operations assistant for a small Norwegian taxi company (~19 drivers, ~14 vehicles, Bolt + Uber).

Principles:
- Be terse. Drivers and admins are busy — one or two sentences unless asked.
- Always think in NOK. Never convert to EUR or USD.
- Prefer calling tools over guessing. If you don't know, look it up.
- For any WRITE action (schedule maintenance, update status, assign driver, log fuel, add cost), call the relevant tool. The system will park it as a pending action and ask the user to confirm before executing.
- After a write is executed, acknowledge it in one sentence citing the record created.
- Use save_memory ONLY for durable facts (preferences, focus vehicles, reporting cadence). Not for one-off questions.
- Dates: interpret relative dates in Europe/Oslo.
- If the user asks about a vehicle or driver, look them up first before speculating.`;

export type ChatResult = {
  reply: string;
  pendingSummary?: string;
  executed?: { tool: string; summary: string };
  toolCallCount: number;
};

export type ChatOptions = {
  principal: Principal;
  channel: "web" | "telegram";
  userText: string;
  /** Extra system-prompt text (e.g. "You are speaking to an ADMIN over Telegram"). */
  extraSystem?: string;
  /** If false, the model is handed only read tools. */
  allowWrites?: boolean;
};

export async function runChatTurn(opts: ChatOptions): Promise<ChatResult> {
  const { principal, channel, userText } = opts;
  const allowWrites = opts.allowWrites ?? true;

  // --- Intercept confirmation replies BEFORE hitting the LLM ---
  const pending = await currentPendingSummary(principal);
  if (pending && CONFIRM_PATTERN.test(userText)) {
    await appendUserMessage(principal, channel, userText);
    const done = await confirmPendingAction(principal);
    if (done.ok) {
      const reply = `Done — ${done.summary}.`;
      await appendAssistantMessage(principal, channel, reply);
      await appendToolResult(principal, channel, done.tool, null, done.result);
      return { reply, executed: { tool: done.tool, summary: done.summary }, toolCallCount: 0 };
    }
    const reply = done.message;
    await appendAssistantMessage(principal, channel, reply);
    return { reply, toolCallCount: 0 };
  }
  if (pending && CANCEL_PATTERN.test(userText)) {
    await appendUserMessage(principal, channel, userText);
    await cancelPendingAction(principal);
    const reply = "Cancelled.";
    await appendAssistantMessage(principal, channel, reply);
    return { reply, toolCallCount: 0 };
  }

  // --- Normal turn: load history + memory, then run tool-use loop ---
  await appendUserMessage(principal, channel, userText);

  const memoryBlock = await loadMemoryBlock(principal);
  const systemPrompt = [
    BASE_SYSTEM,
    opts.extraSystem,
    memoryBlock,
    `Today is ${new Date().toISOString().slice(0, 10)} (Europe/Oslo).`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const history = await loadRecentMessages(principal);
  // loadRecentMessages already includes the user message we just wrote
  const messages: ClaudeMessage[] = [...history];

  const tools = toolDefinitions(allowWrites);

  let iterations = 0;
  let toolCallCount = 0;
  let pendingSummary: string | undefined;
  let executed: { tool: string; summary: string } | undefined;
  let finalText = "";

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const resp = await callClaudeRaw(messages, {
      model: CHAT_MODEL,
      system: systemPrompt,
      maxTokens: 1200,
      temperature: 0.2,
      tools,
    });

    finalText = resp.text;

    if (resp.stopReason !== "tool_use") {
      break;
    }

    const toolUses = resp.blocks.filter(
      (b): b is ClaudeToolUseBlock => b.type === "tool_use",
    );
    if (!toolUses.length) break;

    // Model expects the full assistant turn (text + tool_use) echoed back.
    messages.push({ role: "assistant", content: resp.blocks });

    const toolResults: ClaudeContentBlock[] = [];
    for (const call of toolUses) {
      toolCallCount++;
      if (call.name === "save_memory") {
        const { key, value } = call.input as { key?: string; value?: string };
        if (key && value) await upsertMemory(principal, key, value);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ ok: true }),
        });
        continue;
      }
      const res = await runTool(principal, call.name, call.input, { allowWrites });
      if (res.type === "pending") {
        pendingSummary = res.summary;
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({
            parked: true,
            pendingId: res.pendingId,
            summary: res.summary,
            instructions:
              "Action parked. Tell the user exactly what you will do and ask them to confirm with 'yes' or 'cancel'.",
          }),
        });
      } else if (res.type === "result") {
        await appendToolResult(principal, channel, call.name, call.input, res.output);
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(res.output).slice(0, 8000),
        });
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ error: res.message }),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  const replyText =
    finalText ||
    (pendingSummary
      ? `I'd like to: ${pendingSummary}. Reply "yes" to confirm or "cancel".`
      : "…");

  await appendAssistantMessage(principal, channel, replyText);

  // Fire-and-forget memory distillation.
  void distillMemory(principal, userText, replyText);

  return {
    reply: replyText,
    pendingSummary,
    executed,
    toolCallCount,
  };
}
