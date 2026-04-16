/**
 * POST /api/telegram/webhook
 *
 * Entry point for Telegram updates. Setup (one-time, on a shell):
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "url": "https://<your-domain>/api/telegram/webhook",
 *       "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
 *     }'
 *
 * Security:
 *   - Telegram sends the secret in header `x-telegram-bot-api-secret-token`.
 *   - Only chat ids in TELEGRAM_ADMIN_CHAT_IDS (or previously authorized
 *     TelegramLink rows) get a reply — everyone else gets one polite
 *     "not authorized" and nothing is executed.
 *
 * Supported commands (plus free text which goes to the assistant):
 *   /start    — greeting
 *   /whoami   — prints your chat id + role (useful for first setup)
 *   /brief    — run the daily brief on demand
 *   /reset    — forget conversation history for this chat
 *   /cancel   — cancel a pending write action
 */

import { NextRequest, NextResponse } from "next/server";
import { envSoft } from "@/lib/env";
import {
  authorizeChat,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";
import { runChatTurn } from "@/lib/ai-chat";
import { telegramPrincipal } from "@/lib/ai-memory";
import { cancelPendingAction } from "@/lib/ai-tools";
import { runAgent } from "@/lib/ai-agent";
import { prisma } from "@/lib/prisma";
import { aiConfigured } from "@/lib/anthropic";
import { captureError } from "@/lib/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expectedSecret = envSoft("TELEGRAM_WEBHOOK_SECRET");
  if (expectedSecret) {
    const got = request.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const msg = update.message;
  if (!msg || !msg.text) return NextResponse.json({ ok: true });

  const chatId = msg.chat.id;
  const username = msg.chat.username ?? msg.from?.username;
  const text = msg.text.trim();

  try {
    const link = await authorizeChat(chatId, username);
    if (!link) {
      await sendTelegramMessage(
        chatId,
        `Not authorized. Your chat id is ${chatId} — ask the FleetTrack admin to add it to TELEGRAM_ADMIN_CHAT_IDS.`,
      );
      return NextResponse.json({ ok: true });
    }

    const principal = telegramPrincipal(chatId);

    // --- slash commands ---
    if (text.startsWith("/")) {
      const [cmd] = text.split(/\s+/, 1);
      if (cmd === "/start") {
        await sendTelegramMessage(
          chatId,
          `Hi ${username ?? "there"} — FleetTrack bot online. I remember our conversations, so pick up where you left off any time. Try "/brief" or just ask me anything about the fleet.`,
        );
        return NextResponse.json({ ok: true });
      }
      if (cmd === "/whoami") {
        await sendTelegramMessage(
          chatId,
          `chat_id: ${chatId}\nusername: @${username ?? "?"}\nrole: ${link.role}`,
        );
        return NextResponse.json({ ok: true });
      }
      if (cmd === "/reset") {
        await prisma.aiMessage.deleteMany({ where: { principal } });
        await sendTelegramMessage(chatId, "Conversation cleared. Long-term memory kept.");
        return NextResponse.json({ ok: true });
      }
      if (cmd === "/cancel") {
        const was = await cancelPendingAction(principal);
        await sendTelegramMessage(
          chatId,
          was ? "Pending action cancelled." : "Nothing to cancel.",
        );
        return NextResponse.json({ ok: true });
      }
      if (cmd === "/brief") {
        if (!aiConfigured()) {
          await sendTelegramMessage(chatId, "AI not configured on the server.");
          return NextResponse.json({ ok: true });
        }
        const result = await runAgent("brief");
        if (!result.broadcast) {
          await sendTelegramMessage(chatId, result.text);
        }
        return NextResponse.json({ ok: true });
      }
      // unknown command → fall through to assistant as free text
    }

    if (!aiConfigured()) {
      await sendTelegramMessage(chatId, "AI not configured on the server.");
      return NextResponse.json({ ok: true });
    }

    const result = await runChatTurn({
      principal,
      channel: "telegram",
      userText: text,
      extraSystem: `You are speaking with a FleetTrack ${link.role} over Telegram. Keep replies under 10 lines unless the user asks for more detail. Use plain text (no Markdown). For write actions, park them and ask for "yes" / "cancel".`,
      allowWrites: true,
    });

    await sendTelegramMessage(chatId, result.reply);
  } catch (err) {
    await captureError(err, { route: "/api/telegram/webhook" });
    try {
      await sendTelegramMessage(
        chatId,
        "Something broke on my side. The dev has been notified.",
      );
    } catch {
      /* already failing; nothing to do */
    }
  }

  return NextResponse.json({ ok: true });
}
