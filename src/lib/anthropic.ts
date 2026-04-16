/**
 * Thin wrapper around the Anthropic Messages API.
 *
 * Uses direct fetch instead of @anthropic-ai/sdk to keep the Vercel
 * build small and avoid transitive deps. All calls go through callClaude()
 * which validates the key exists, handles retries, and logs cost.
 */

import { envSoft } from "./env";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5"; // fast + cheap for per-request analysis
export const CHAT_MODEL = "claude-haiku-4-5"; // assistant turns
export const AGENT_MODEL = "claude-sonnet-4-6"; // scheduled analysis + digests
const DEFAULT_MAX_TOKENS = 1024;

export type ClaudeTextBlock = { type: "text"; text: string };
export type ClaudeToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ClaudeToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock;

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

export type ClaudeToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ClaudeOptions = {
  system?: string;
  maxTokens?: number;
  model?: string;
  temperature?: number;
  /** Force the model to emit JSON. Wraps the user prompt with a reminder. */
  json?: boolean;
  tools?: ClaudeToolDef[];
};

export type ClaudeResponse = {
  stopReason: string | null;
  text: string;
  blocks: ClaudeContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
};

export class AiError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function aiConfigured(): boolean {
  return !!envSoft("ANTHROPIC_API_KEY");
}

export async function callClaude(
  messages: ClaudeMessage[],
  opts: ClaudeOptions = {},
): Promise<string> {
  const resp = await callClaudeRaw(messages, opts);
  return resp.text;
}

/**
 * Full response form — returns text, stop_reason, and any tool_use blocks
 * so the caller can implement a tool-use loop. Use this from the chat
 * route and the Telegram webhook; plain callClaude() is fine for single
 * shot text.
 */
export async function callClaudeRaw(
  messages: ClaudeMessage[],
  opts: ClaudeOptions = {},
): Promise<ClaudeResponse> {
  const key = envSoft("ANTHROPIC_API_KEY");
  if (!key) {
    throw new AiError(
      "ANTHROPIC_API_KEY not configured. Add it to Vercel env vars.",
      503,
    );
  }

  const lastMsg = messages[messages.length - 1];
  const shouldInjectJsonHint =
    opts.json && lastMsg && typeof lastMsg.content === "string";
  const body: Record<string, unknown> = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? 0.3,
    system: opts.system,
    messages: shouldInjectJsonHint
      ? [
          ...messages.slice(0, -1),
          {
            ...lastMsg,
            content:
              (lastMsg.content as string) +
              "\n\nReply with ONLY valid JSON matching the schema. No markdown, no prose, no code fences.",
          },
        ]
      : messages,
  };
  if (opts.tools?.length) body.tools = opts.tools;

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new AiError(
      `Anthropic API ${res.status}`,
      res.status >= 500 ? 502 : res.status,
      errTxt,
    );
  }

  const data = (await res.json()) as {
    content?: ClaudeContentBlock[];
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const blocks = data.content ?? [];
  const text = blocks
    .filter((c): c is ClaudeTextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  return {
    stopReason: data.stop_reason ?? null,
    text,
    blocks,
    usage: data.usage,
  };
}

/** Parse a JSON response from Claude defensively — strips code fences if present. */
export function parseAiJson<T = unknown>(raw: string): T {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/i, "");
  }
  return JSON.parse(clean) as T;
}
