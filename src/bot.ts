import "dotenv/config";
import { Bot, InputFile } from "grammy";
import { promises as fs } from "node:fs";
import { cloneHomepage } from "./cloneHomepage.js";

const token = process.env.BOT_TOKEN;
const allowedChatId = process.env.ALLOWED_CHAT_ID;

if (!token) {
  throw new Error("BOT_TOKEN is missing. Add it to .env or deployment secrets.");
}

if (!allowedChatId) {
  throw new Error("ALLOWED_CHAT_ID is missing. Add it to .env or deployment secrets.");
}

const bot = new Bot(token);
let isCapturing = false;

function isAllowedChat(chatId: number | string): boolean {
  return String(chatId) === String(allowedChatId);
}

function looksLikeDomain(value: string): boolean {
  const text = value.trim();
  if (!text || text.includes(" ")) return false;

  try {
    const normalized = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(normalized);
    return Boolean(url.hostname && url.hostname.includes("."));
  } catch {
    return false;
  }
}

async function captureAndSend(ctx: Parameters<Parameters<typeof bot.command>[1]>[0], raw: string) {
  if (isCapturing) {
    await ctx.reply("⏳ Зараз уже обробляється інший сайт. Дочекайся ZIP і надішли наступний домен.");
    return;
  }

  isCapturing = true;
  const status = await ctx.reply(
    `🔎 Прийняв: ${raw.trim()}\n\nВідкриваю тільки цю сторінку, збираю дизайн та готую ZIP…`,
  );

  let outputDir: string | undefined;
  let zipPath: string | undefined;

  try {
    const result = await cloneHomepage(raw.trim());
    outputDir = result.outputDir;
    zipPath = result.zipPath;

    const stat = await fs.stat(result.zipPath);
    const sizeMb = stat.size / 1024 / 1024;

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `✅ Готово\n\n🌐 ${result.url}\n📄 Сторінок: 1\n🎨 Assets: ${result.assetCount}\n📦 ZIP: ${sizeMb.toFixed(1)} MB\n\nНадсилаю файл…`,
    );

    await ctx.replyWithDocument(new InputFile(result.zipPath), {
      caption: `📦 ${result.hostname} — homepage design capture`,
    });

    await ctx.reply("✅ Готово. Надішли наступний домен, якщо потрібно скопіювати ще один сайт.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Невідома помилка";
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не вдалося обробити сайт:\n${message.slice(0, 3500)}\n\nНадішли домен ще раз.`,
    );
  } finally {
    if (outputDir) await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    if (zipPath) await fs.rm(zipPath, { force: true }).catch(() => undefined);
    isCapturing = false;
  }
}

bot.use(async (ctx, next) => {
  if (!ctx.chat) return;

  if (!isAllowedChat(ctx.chat.id)) {
    console.warn(`Blocked Telegram chat: ${ctx.chat.id}`);
    return;
  }

  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🎨 Homepage Design Cloner\n\nНадішли домен сайту, дизайн головної сторінки якого потрібно зберегти.\n\nНаприклад:\npts-cooperation.com\n\nЯ візьму тільки одну сторінку та поверну готовий ZIP.",
  );
});

bot.command("clone", async (ctx) => {
  const raw = ctx.match?.trim();
  if (!raw) {
    await ctx.reply("🌐 Просто надішли домен сайту.\nНаприклад: pts-cooperation.com");
    return;
  }

  await captureAndSend(ctx, raw);
});

bot.on("message:text", async (ctx) => {
  const raw = ctx.message.text.trim();

  if (raw.startsWith("/")) return;

  if (!looksLikeDomain(raw)) {
    await ctx.reply(
      "⚠️ Схоже, це не домен.\n\nНадішли щось у форматі:\nexample.com\nабо\nhttps://example.com",
    );
    return;
  }

  await captureAndSend(ctx, raw);
});

bot.catch((error) => {
  console.error("Telegram bot error:", error.error);
});

console.log("Homepage Design Cloner bot started");
void bot.start();
