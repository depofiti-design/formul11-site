// Tek seferlik düzeltme: caption'sız gönderilen "bizi takip et" postunu
// silip, Instagram/X hesap bilgisiyle birlikte yeniden gönderir.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN tanımlı değil");

const CHAT_ID = "@formul11pro";
const OLD_MESSAGE_ID = 7;
const PHOTO_URL = "https://formul11.vercel.app/social-assets/05-bizi-takip-et.png";
const CAPTION = `📲 Bizi her yerde takip et.

Instagram: @formul11pro
X: @formul11pro
Telegram: zaten buradasın 👋

Analizler, veriler, güncellemeler — hepsi tek yerde.`;

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok || !result.ok) {
    throw new Error(`${method} başarısız: ${JSON.stringify(result)}`);
  }
  return result;
}

await call("deleteMessage", { chat_id: CHAT_ID, message_id: OLD_MESSAGE_ID });
console.log(`Silindi: message_id ${OLD_MESSAGE_ID}`);

const sent = await call("sendPhoto", { chat_id: CHAT_ID, photo: PHOTO_URL, caption: CAPTION });
console.log(`Yeniden gönderildi: message_id ${sent.result.message_id}`);
