const TELEGRAM_API = "https://api.telegram.org";
const GITHUB_API = "https://api.github.com";
const REPO = "SviatF/clone-website";
const WORKFLOW_FILE = "capture.yml";

function normalizeDomain(input: string): string | null {
  const value = input.trim();
  if (!value || value.includes(" ")) return null;

  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalized);
    if (!url.hostname || !url.hostname.includes(".")) return null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram ${method} failed: ${response.status} ${text}`);
  }
}

async function dispatchCapture(url: string, chatId: string) {
  const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
  if (!githubToken) throw new Error("GITHUB_ACTIONS_TOKEN is missing");

  const response = await fetch(`${GITHUB_API}/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "pts-clone-sites-bot",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        url,
        chat_id: chatId,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${text}`);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "PTS Clone Sites Telegram webhook" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (receivedSecret !== webhookSecret) {
      return res.status(401).json({ ok: false });
    }
  }

  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();

    if (!chatId || !text) {
      return res.status(200).json({ ok: true });
    }

    const allowedChatId = process.env.ALLOWED_CHAT_ID;
    if (allowedChatId && String(chatId) !== String(allowedChatId)) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (/^\/start(?:@\w+)?$/i.test(text)) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "🎨 PTS Clone Sites\n\nНадішли домен сайту, наприклад:\npts-cooperation.com\n\nЯ збережу тільки головну сторінку та після обробки надішлю ZIP.",
      });
      return res.status(200).json({ ok: true });
    }

    const commandMatch = text.match(/^\/clone(?:@\w+)?\s+(.+)$/i);
    const candidate = commandMatch?.[1]?.trim() || text;

    if (candidate.startsWith("/")) {
      return res.status(200).json({ ok: true });
    }

    const url = normalizeDomain(candidate);
    if (!url) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Надішли домен у форматі example.com або https://example.com",
      });
      return res.status(200).json({ ok: true });
    }

    await dispatchCapture(url, String(chatId));

    await telegram("sendMessage", {
      chat_id: chatId,
      text: `🔎 Прийняв ${url}\n\nЗапустив копіювання головної сторінки. ZIP прийде сюди автоматично після завершення.`,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ ok: true, error: error instanceof Error ? error.message : "unknown" });
  }
}
