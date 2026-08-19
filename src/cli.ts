import { cloneHomepage } from "./cloneHomepage.js";

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error("Usage: npm run clone -- https://example.com");
  process.exit(1);
}

try {
  const result = await cloneHomepage(rawUrl);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
