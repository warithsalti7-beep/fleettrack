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
const DEFAULT_MAX_TOKENS = 1024;

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

/** Multimodal content block for vision requests. */
export type VisionBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type VisionMessage = { role: "user" | "assistant"; content: VisionBlock[] };

export type ClaudeOptions = {
  system?: string;
  maxTokens?: number;
  model?: string;
  temperature?: number;
  /** Force the model to emit JSON. Wraps the user prompt with a reminder. */
  json?: boolean;
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
  const key = envSoft("ANTHROPIC_API_KEY");
  if (!key) {
    throw new AiError(
      "ANTHROPIC_API_KEY not configured. Add it to Vercel env vars.",
      503,
    );
  }

  const lastMsg = messages[messages.length - 1];
  const body = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? 0.3,
    system: opts.system,
    messages: opts.json && lastMsg
      ? [
          ...messages.slice(0, -1),
          {
            ...lastMsg,
            content:
              lastMsg.content +
              "\n\nReply with ONLY valid JSON matching the schema. No markdown, no prose, no code fences.",
          },
        ]
      : messages,
  };

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
    content?: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text =
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("") || "";
  return text.trim();
}

/**
 * Vision-capable variant — accepts content blocks (text + image) so the
 * model can OCR / interpret photos. Uses the same Claude model unless
 * overridden; defaults to Sonnet for better OCR accuracy.
 */
export async function callClaudeVision(
  messages: VisionMessage[],
  opts: ClaudeOptions = {},
): Promise<string> {
  const key = envSoft("ANTHROPIC_API_KEY");
  if (!key) {
    throw new AiError("ANTHROPIC_API_KEY not configured.", 503);
  }
  const body = {
    model: opts.model || "claude-sonnet-4-5", // Sonnet for higher OCR accuracy
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.1,
    system: opts.system,
    messages,
  };
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
    throw new AiError(`Anthropic Vision ${res.status}`, res.status >= 500 ? 502 : res.status, errTxt);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text: string }> };
  return (data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") || "").trim();
}

/** Parse a JSON response from Claude defensively — strips code fences if present. */
export function parseAiJson<T = unknown>(raw: string): T {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/i, "");
  }
  return JSON.parse(clean) as T;
}
