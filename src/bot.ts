import "dotenv/config";
import { Bot, InputFile } from "grammy";
import { promises as fs } from "node:fs";
import { cloneHomepage } from "./cloneHomepage.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is missing. Add it to .env or GitHub Actions secrets.");
}

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🎨 Homepage Design Cloner\n\nНадішли:\n/clone https://example.com\n\nЯ відкрию тільки цей URL, зроблю full-page screenshot, збережу rendered HTML, завантажені CSS/JS/images/fonts та design.json і поверну ZIP.",
  );
});

bot.command("clone", async (ctx) => {
  const raw = ctx.match?.trim();
  if (!raw) {
    await ctx.reply("Вкажи URL після команди.\nПриклад: /clone https://example.com");
    return;
  }

  const status = await ctx.reply("🔎 Відкриваю тільки головну сторінку та збираю дизайн-ресурси…");

  try {
    const result = await cloneHomepage(raw);
    const stat = await fs.stat(result.zipPath);
    const sizeMb = stat.size / 1024 / 1024;

    await ctx.api.editMessageText(
      ctx.chat.id,
      status.message_id,
      `✅ Готово\n\n🌐 ${result.url}\n📄 Режим: тільки 1 сторінка\n🎨 Assets: ${result.assetCount}\n📦 ZIP: ${sizeMb.toFixed(1)} MB`,
    );

    await ctx.replyWithDocument(new InputFile(result.zipPath), {
      caption: `${result.hostname} — homepage design capture`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Невідома помилка";
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, `❌ Не вдалося скопіювати сторінку:\n${message.slice(0, 3500)}`);
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error.error);
});

console.log("Homepage Design Cloner bot started");
void bot.start();
