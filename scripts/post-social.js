// Formül11 — kuyruktaki bir sonraki sosyal medya görselini Telegram'a gönderir.
// GitHub Actions cron'u ile çalışır (bkz. .github/workflows/social-post.yml).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN tanımlı değil");
}

const CHAT_ID = "@formul11pro";
const PUBLIC_BASE_URL = "https://formul11.vercel.app/social-assets";

// Git identity: yanlış/eksik identity Vercel deploy'unu BLOCKED yapıyor, bkz. CLAUDE.md.
const GIT_AUTHOR = {
  GIT_AUTHOR_NAME: "depofiti-design",
  GIT_AUTHOR_EMAIL: "227688926+depofiti-design@users.noreply.github.com",
  GIT_COMMITTER_NAME: "depofiti-design",
  GIT_COMMITTER_EMAIL: "227688926+depofiti-design@users.noreply.github.com",
};

const queue = JSON.parse(readFileSync("social-queue.json", "utf-8"));
const state = JSON.parse(readFileSync("social-state.json", "utf-8"));

if (state.next_index >= queue.length) {
  console.log("Kuyruk tükendi — gönderilecek yeni post kalmadı.");
  process.exit(0);
}

const item = queue[state.next_index];
const photoUrl = `${PUBLIC_BASE_URL}/${item.file}`;

const body = { chat_id: CHAT_ID, photo: photoUrl };
if (item.caption) body.caption = item.caption;

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const result = await res.json();

if (!res.ok || !result.ok) {
  throw new Error(`Telegram gönderimi başarısız: ${JSON.stringify(result)}`);
}

console.log(`Gönderildi: ${item.file} (index ${state.next_index})`);

state.next_index += 1;
writeFileSync("social-state.json", JSON.stringify(state, null, 2) + "\n");

execSync("git add social-state.json", { stdio: "inherit" });
execSync(
  `git commit -m "Sosyal medya kuyruğu: ${item.file} gönderildi (index ${state.next_index - 1})"`,
  { stdio: "inherit", env: { ...process.env, ...GIT_AUTHOR } }
);
execSync("git push", { stdio: "inherit" });
