/**
 * Telegram bot helpers.
 *
 * Allowlist: the bot only talks to chat ids configured via env
 *   TELEGRAM_ADMIN_CHAT_IDS="123456789,987654321"
 * OR the chat is already present in the TelegramLink table. Everyone
 * else gets a single "unauthorized" reply and the message is dropped.
 */

import { envSoft } from "./env";
import { prisma } from "./prisma";

const API_BASE = "https://api.telegram.org";

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string; username?: string };
    date: number;
    text?: string;
  };
};

export function telegramConfigured(): boolean {
  return !!envSoft("TELEGRAM_BOT_TOKEN");
}

function adminIdsFromEnv(): Set<string> {
  const raw = envSoft("TELEGRAM_ADMIN_CHAT_IDS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Returns the allowlist entry for a chat, creating one on first contact
 * if the chat id is in TELEGRAM_ADMIN_CHAT_IDS. Unauthorized chats
 * return null.
 */
export async function authorizeChat(chatId: number, username?: string) {
  const chatIdStr = String(chatId);
  const existing = await prisma.telegramLink.findUnique({
    where: { chatId: chatIdStr },
  });
  if (existing) {
    if (existing.username !== username && username) {
      await prisma.telegramLink.update({
        where: { id: existing.id },
        data: { username, lastSeenAt: new Date() },
      });
    } else {
      await prisma.telegramLink.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return existing;
  }
  if (adminIdsFromEnv().has(chatIdStr)) {
    return prisma.telegramLink.create({
      data: { chatId: chatIdStr, username, role: "admin" },
    });
  }
  return null;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  opts: { parseMode?: "Markdown" | "HTML" } = {},
): Promise<void> {
  const token = envSoft("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4000), // Telegram hard limit is 4096
    disable_web_page_preview: true,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // swallow — logging already happens at the call site
    const txt = await res.text().catch(() => "");
    console.warn("telegram sendMessage failed", res.status, txt);
  }
}

/** Broadcast helper for the agent — DMs every authorized admin chat. */
export async function broadcastToAdmins(text: string) {
  const chats = await prisma.telegramLink.findMany({
    where: { role: { in: ["admin", "developer"] } },
  });
  await Promise.all(chats.map((c) => sendTelegramMessage(c.chatId, text)));
}
