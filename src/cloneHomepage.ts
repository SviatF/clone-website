import { chromium, type Response, type Page } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import archiver from "archiver";
import { createWriteStream } from "node:fs";

export type CloneResult = {
  url: string;
  hostname: string;
  outputDir: string;
  zipPath: string;
  screenshotPath: string;
  assetCount: number;
};

const DOWNLOAD_ROOT = path.resolve(process.cwd(), "downloads");

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const normalized = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const url = new URL(normalized);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Підтримуються лише http/https URL.");
  }

  if (url.username || url.password) {
    throw new Error("URL з логіном/паролем не підтримуються.");
  }

  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("Локальні адреси заборонені.");
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Приватні або локальні мережеві адреси заборонені.");
  }

  return url;
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function extensionFrom(contentType: string, url: URL): string {
  const pathnameExt = path.extname(url.pathname).slice(0, 12);
  if (pathnameExt && /^[.][a-z0-9]+$/i.test(pathnameExt)) return pathnameExt;
  const type = contentType.toLowerCase();
  if (type.includes("text/css")) return ".css";
  if (type.includes("javascript")) return ".js";
  if (type.includes("image/jpeg")) return ".jpg";
  if (type.includes("image/png")) return ".png";
  if (type.includes("image/webp")) return ".webp";
  if (type.includes("image/svg")) return ".svg";
  if (type.includes("image/gif")) return ".gif";
  if (type.includes("font/woff2")) return ".woff2";
  if (type.includes("font/woff")) return ".woff";
  if (type.includes("font/ttf")) return ".ttf";
  if (type.includes("font/otf")) return ".otf";
  if (type.includes("application/json")) return ".json";
  return ".bin";
}

function assetBucket(contentType: string): string | null {
  const type = contentType.toLowerCase();
  if (type.includes("text/css")) return "css";
  if (type.includes("javascript")) return "js";
  if (type.startsWith("image/")) return "images";
  if (type.includes("font/") || type.includes("woff") || type.includes("opentype")) return "fonts";
  return null;
}

async function saveResponseAsset(response: Response, outputDir: string, seen: Set<string>): Promise<boolean> {
  const resourceUrl = response.url();
  if (seen.has(resourceUrl)) return false;

  let parsed: URL;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  const contentType = response.headers()["content-type"] || "";
  const bucket = assetBucket(contentType);
  if (!bucket) return false;

  seen.add(resourceUrl);

  try {
    const body = await response.body();
    if (!body.length) return false;
    const ext = extensionFrom(contentType, parsed);
    const fileName = `${sha1(resourceUrl)}${ext}`;
    const dir = path.join(outputDir, "assets", bucket);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), body);
    return true;
  } catch {
    return false;
  }
}

async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(`
    (async () => {
      await new Promise((resolve) => {
        let total = 0;
        const distance = 700;
        const timer = setInterval(() => {
          const height = document.documentElement.scrollHeight;
          window.scrollBy(0, distance);
          total += distance;
          if (total >= height || total > 30000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 100);
      });
    })()
  `);
}

async function extractDesign(page: Page): Promise<unknown> {
  return page.evaluate(`
    (() => {
      const elements = Array.from(document.querySelectorAll("body *"));
      const colors = new Set();
      const fonts = new Set();
      const radii = new Set();

      for (const element of elements.slice(0, 5000)) {
        const style = getComputedStyle(element);
        if (style.color && style.color !== "rgba(0, 0, 0, 0)") colors.add(style.color);
        if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") colors.add(style.backgroundColor);
        if (style.fontFamily) fonts.add(style.fontFamily);
        if (style.borderRadius && style.borderRadius !== "0px") radii.add(style.borderRadius);
      }

      const makeRect = (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      };

      return {
        capturedAt: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          title: document.title
        },
        colors: Array.from(colors).slice(0, 100),
        fonts: Array.from(fonts).slice(0, 50),
        borderRadii: Array.from(radii).slice(0, 50),
        headings: Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 100).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 500),
          rect: makeRect(el)
        })),
        buttons: Array.from(document.querySelectorAll("button,a[role='button'],input[type='submit']")).slice(0, 100).map((el) => ({
          text: (el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 300),
          rect: makeRect(el)
        })),
        sections: Array.from(document.querySelectorAll("header,main > section,body > section,footer")).slice(0, 100).map((el, index) => ({
          index,
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: typeof el.className === "string" ? el.className.slice(0, 500) : null,
          rect: makeRect(el)
        }))
      };
    })()
  `);
}

async function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}

export async function cloneHomepage(rawUrl: string): Promise<CloneResult> {
  const target = await assertPublicUrl(rawUrl);
  const hostname = target.hostname.replace(/[^a-z0-9.-]/gi, "_");
  const id = `${hostname}-${Date.now()}`;
  const outputDir = path.join(DOWNLOAD_ROOT, id);
  const zipPath = path.join(DOWNLOAD_ROOT, `${id}.zip`);
  const screenshotPath = path.join(outputDir, "screenshot.png");

  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  });
  const page = await context.newPage();
  const seenAssets = new Set<string>();
  const assetPromises: Promise<boolean>[] = [];

  page.on("response", (response) => {
    assetPromises.push(saveResponseAsset(response, outputDir, seenAssets));
  });

  try {
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
    await autoScroll(page);
    await page.waitForTimeout(1200);

    const html = await page.content();
    await fs.writeFile(path.join(outputDir, "index.html"), html, "utf8");

    const design = await extractDesign(page);
    await fs.writeFile(
      path.join(outputDir, "design.json"),
      JSON.stringify({ sourceUrl: target.toString(), ...(design as Record<string, unknown>) }, null, 2),
      "utf8",
    );

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const assetResults = await Promise.allSettled(assetPromises);
    const assetCount = assetResults.filter((result) => result.status === "fulfilled" && result.value).length;

    await fs.writeFile(
      path.join(outputDir, "README.txt"),
      `Source: ${target.toString()}\nMode: single-page capture only\nAssets captured from network requests made while rendering this page.\n`,
      "utf8",
    );

    await zipDirectory(outputDir, zipPath);

    return {
      url: target.toString(),
      hostname,
      outputDir,
      zipPath,
      screenshotPath,
      assetCount,
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
