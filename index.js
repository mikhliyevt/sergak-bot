require('dotenv').config();
const http = require('http');
const { Bot, InlineKeyboard } = require('grammy');
const Database = require('better-sqlite3');

// Bulutli serverlar (Render, Koyeb) uchun veb-server (Health Check)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🛡 Sergak Bot 24/7 faol ishlamoqda!\n');
}).listen(PORT, () => {
  console.log(`🌐 Server monitoring porti: ${PORT}`);
});

const bot = new Bot(process.env.BOT_TOKEN);
const db = new Database('./messages.db');

// HTML xavfsiz qilish uchun yordamchi funksiya
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Baza jadvallarini yaratish
db.exec(`
  CREATE TABLE IF NOT EXISTS business_connections (
    connection_id TEXT PRIMARY KEY,
    user_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER,
    chat_id INTEGER,
    sender_id INTEGER,
    sender_name TEXT,
    sender_username TEXT,
    text TEXT,
    created_at TEXT,
    PRIMARY KEY (message_id, chat_id)
  );
`);

// Eski jadvallarga yangi ustunlar qo'shish (agar bo'lmasa)
try { db.prepare("ALTER TABLE messages ADD COLUMN sender_id INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN sender_username TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN created_at TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT").run(); } catch (e) {}

// Akkaunt egasini aniqlash (bazadan yoki Telegram API dan)
async function getOwnerId(connectionId) {
  if (!connectionId) return null;

  // 1. Bazadan qidirish
  const row = db.prepare('SELECT user_id FROM business_connections WHERE connection_id = ?').get(connectionId);
  if (row && row.user_id) {
    return row.user_id;
  }

  // 2. Telegram Bot API orqali to'g'ridan-to'g'ri olish
  try {
    const conn = await bot.api.getBusinessConnection(connectionId);
    if (conn && conn.user) {
      const ownerId = conn.user.id;
      db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)')
        .run(connectionId, ownerId);
      console.log(`[ULANISH] Yangi ulanish saqlandi: ${connectionId} -> ${ownerId}`);
      return ownerId;
    }
  } catch (err) {
    console.log(`[XATO] getBusinessConnection xatolik:`, err.message);
  }

  return null;
}

// Asosiy menyu tugmalari
function getMainKeyboard() {
  return new InlineKeyboard()
    .text("📱 iPhone", "help_iphone")
    .text("🤖 Android", "help_android")
    .row()
    .text("💻 Desktop (Kompyuter)", "help_desktop")
    .row()
    .text("🎁 Donat (Sovg'a)", "help_donation")
    .text("ℹ️ Bot haqida", "about_bot");
}

const startMessage = `
🛡 <b>Sergak Bot</b>ga xush kelibsiz!

Ushbu bot profilingizga ulanib, sizga kelgan va keyinchalik o'chirilgan yoki tahrirlangan barcha xabarlarni maxfiy tarzda yetkazib beradi.

🎁 <b>Bot xizmati 100% BEPUL!</b> Hech qanday to'lovlarsiz cheksiz foydalanishingiz mumkin.
🔒 <b>100% Maxfiy:</b> Suhbatdoshingiz sizda bu bot borligini aslo bilmaydi!

Qurilmangiz turini tanlang va botni profilingizga ulang 👇
`;

// /start buyrug'i
bot.command(['start', 'help'], async (ctx) => {
  const userId = ctx.from.id;
  db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(userId, new Date().toISOString());

  await ctx.reply(startMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard()
  });
});

// Yo'riqnoma tugmalari (iPhone)
bot.callbackQuery('help_iphone', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  const iphoneHelp = `
📱 <b>iPhone (iOS) uchun ulanish yo'riqnomasi:</b>

1️⃣ Telegram <b>Sozlamalar (Settings)</b> bo'limiga kiring.
2️⃣ Yuqoridagi <b>profilingiz</b> ustiga bosib, <b>"Изм." (Edit)</b> tugmasini bosing.
3️⃣ Pastga aylantirib <b>"Chat automation" (Автоматизация чатов)</b> bo'limini tanlang.
4️⃣ Qidiruvga <b>@${botInfo.username}</b> deb yozing va ruxsatlarni yoqib ulab qo'ying.

✅ <b>Tayyor!</b> Endi barcha o'chirilgan va o'zgartirilgan xabarlar sizga keladi.
  `;
  await ctx.reply(iphoneHelp, { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

// Yo'riqnoma tugmalari (Android)
bot.callbackQuery('help_android', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  const androidHelp = `
🤖 <b>Android uchun ulanish yo'riqnomasi:</b>

1️⃣ Telegram <b>Sozlamalar (Settings)</b> bo'limiga kiring.
2️⃣ <b>"Akkaunt" (Account / Аккаунт)</b> bo'limiga kiring.
3️⃣ <b>"Chat automation" (Автоматизация чатов)</b> bo'limini tanlang.
4️⃣ Qidiruv maydoniga <b>@${botInfo.username}</b> deb yozing.
5️⃣ Botni tanlang va ulab qo'ying.

✅ <b>Tayyor!</b> Bot fon rejimida xabarlarni kuzatishni boshlaydi.
  `;
  await ctx.reply(androidHelp, { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

// Yo'riqnoma tugmalari (Desktop)
bot.callbackQuery('help_desktop', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  const desktopHelp = `
💻 <b>Desktop (Kompyuter) uchun ulanish yo'riqnomasi:</b>

1️⃣ Kompyuteringizda Telegram dasturini oching.
2️⃣ <b>Sozlamalar (Settings / Настройки)</b> bo'limiga kiring.
3️⃣ <b>"Akkaunt" (Account / Аккаунт)</b> bo'limiga kiring.
4️⃣ <b>"Chat automation" (Автоматизация чатов)</b> bo'limini tanlang.
5️⃣ Qidiruv maydoniga <b>@${botInfo.username}</b> deb yozing va ulab qo'ying.

✅ <b>Tayyor!</b> Kompyuterda ham barcha o'chirilgan va tahrirlangan xabarlar shu botga keladi.
  `;
  await ctx.reply(desktopHelp, { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

// Donat bo'limi
bot.callbackQuery('help_donation', async (ctx) => {
  await ctx.answerCallbackQuery();
  const donationText = `
🎁 <b>Loyiha rivoji uchun (Donat):</b>

Sergak Bot barcha uchun <b>100% BEPUL</b> va cheklovlarsiz ishlaydi!

Agar bot sizga yoqqan bo'lsa va loyiha rivojini, server xarajatlarini qo'llab-quvvatlamoqchi bo'lsangiz, asoschining Telegram profiliga <b>Telegram Gift (Sovg'a)</b> yuborishingiz mumkin! 🎁✨

👉 <b>Asoschi profili:</b> @mikhliyevt

<i>Har bir e'tibor va sovg'angiz loyihani yanada rivojlantirishga katta hissa qo'shadi! Rahmat!</i> ❤️
  `;
  const keyboard = new InlineKeyboard()
    .url("🎁 Sovg'a yuborish (@mikhliyevt)", "https://t.me/mikhliyevt")
    .row()
    .text("◀️ Ortga", "back_to_main");

  await ctx.reply(donationText, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
});

// Bot haqida bo'limi
bot.callbackQuery('about_bot', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(`
ℹ️ <b>Sergak Bot qanday ishlaydi?</b>

1. Siz botni Telegram Business orqali profilingizga ulaysiz.
2. Suhbatdoshingiz sizga shaxsiy xabar yozganida, bot uni vaqtinchalik xotiraga saqlaydi.
3. Agar suhbatdosh xabarni <b>tahrirlasa (edit)</b> yoki <b>o'chirsa (delete)</b>, bot darhol asl matnni sizga yetkazadi.
4. <b>100% Yashirin:</b> Suhbatdosh sizda bot borligini sezmaydi, chunki do'stingiz bilan bo'lgan chatga hech narsa yozilmaydi.
5. Agar o'zingiz xabarni tahrirlasangiz yoki o'chirsangiz, bot sizni bezovta qilmaydi.
  `, { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

// Asosiy menyuga qaytish
bot.callbackQuery('back_to_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(startMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard()
  });
});

// Akkaunt egasi botni o'z Telegramiga ulaganda
bot.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection;
  console.log(`[EVENT: business_connection] id=${conn.id}, user=${conn.user ? conn.user.id : 'unknown'}, is_enabled=${conn.is_enabled}`);

  if (conn.is_enabled && conn.user) {
    db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)').run(conn.id, conn.user.id);
    db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(conn.user.id, new Date().toISOString());

    try {
      await bot.api.sendMessage(conn.user.id, "✅ <b>Sergak Bot profilingizga muvaffaqiyatli ulandi!</b>\n\nEndi sizga yozib o'chirilgan yoki o'zgartirilgan barcha xabarlar to'g'ridan-to'g'ri shu yerga yetkaziladi. Xizmatdan bepul va cheksiz foydalanishingiz mumkin!", {
        parse_mode: 'HTML'
      });
    } catch (e) {
      console.log("[XATO] Ulanish xabarini yuborishda:", e.message);
    }
  } else {
    db.prepare('DELETE FROM business_connections WHERE connection_id = ?').run(conn.id);
  }
});

// Kiruvchi biznes xabarlarini bazaga yashirincha saqlash
bot.on('business_message', async (ctx) => {
  const msg = ctx.businessMessage;
  if (!msg) return;

  const text = msg.text || msg.caption || "[Media fayl / Rasm / Ovozli xabar]";
  const senderName = msg.from ? (msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '')) : "Noma'lum";
  const senderUsername = msg.from ? msg.from.username : null;

  await getOwnerId(msg.business_connection_id);

  console.log(`[EVENT: business_message] msg_id=${msg.message_id}, from=${senderName}, text=${text.substring(0, 30)}`);

  const stmtMsg = db.prepare(`
    INSERT OR REPLACE INTO messages (message_id, chat_id, sender_id, sender_name, sender_username, text, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmtMsg.run(msg.message_id, msg.chat.id, msg.from ? msg.from.id : 0, senderName, senderUsername, text, new Date().toISOString());
});

// ==========================================
// Tahrirlangan xabarlarni ushlash (Edit)
// ==========================================
bot.on('edited_business_message', async (ctx) => {
  const msg = ctx.editedBusinessMessage;
  if (!msg) return;

  const ownerId = await getOwnerId(msg.business_connection_id);
  if (!ownerId) return;

  if (msg.from && msg.from.id === ownerId) {
    return; // O'zi edit qilgan bo'lsa e'tiborga olinmaydi
  }

  const stmtSelect = db.prepare('SELECT text FROM messages WHERE message_id = ? AND chat_id = ?');
  const oldMsg = stmtSelect.get(msg.message_id, msg.chat.id);
  
  const newText = msg.text || msg.caption || "[Media fayl / Rasm / Ovozli xabar]";
  const senderName = msg.from ? msg.from.first_name : "Suhbatdoshingiz";
  const senderUsername = msg.from ? msg.from.username : null;

  const oldTextContent = oldMsg ? oldMsg.text : "[Topilmadi]";

  if (oldMsg && oldTextContent !== newText) {
    let report = `<b>${escapeHtml(senderName)}</b> xabarni tahrirladi:\n\n⏳ <b>Eski:</b> <s>${escapeHtml(oldTextContent)}</s>\n🔄 <b>Yangi:</b> <b>${escapeHtml(newText)}</b>`;

    let keyboard;
    if (senderUsername && senderUsername.trim() !== "") {
      const profileUrl = `https://t.me/${senderUsername}`;
      keyboard = new InlineKeyboard().url("👤 Profilni ko'rish", profileUrl);
    } else {
      report += `\n\n🔒 <i>Xavfsizlik uchun bu odamning profilini ko'rsata olmaymiz, chunki uning username'i yo'q.</i>`;
      keyboard = undefined;
    }

    try {
      await bot.api.sendMessage(ownerId, report, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.log("[XATO] Edit xabarini yuborishda:", err.message);
    }

    db.prepare('UPDATE messages SET text = ? WHERE message_id = ? AND chat_id = ?').run(newText, msg.message_id, msg.chat.id);
  }
});

// ==========================================
// O'chirilgan xabarlarni ushlash (Delete)
// ==========================================
bot.on('deleted_business_messages', async (ctx) => {
  const deletion = ctx.deletedBusinessMessages;
  if (!deletion) return;

  const ownerId = await getOwnerId(deletion.business_connection_id);
  if (!ownerId) return;

  for (const msgId of deletion.message_ids) {
    const stmtSelect = db.prepare('SELECT sender_id, sender_name, sender_username, text FROM messages WHERE message_id = ? AND chat_id = ?');
    const deletedMsg = stmtSelect.get(msgId, deletion.chat.id);

    if (deletedMsg) {
      if (deletedMsg.sender_id === ownerId) {
        continue; // O'zi o'chirgan bo'lsa tashlab yuboramiz
      }

      const messageContent = deletedMsg.text || "[Media fayl / Rasm / Ovozli xabar]";

      let report = `<b>${escapeHtml(deletedMsg.sender_name)}</b> xabarni o'chirdi:\n\n🗑 <b>O'chirilgan xabar:</b>\n<b>${escapeHtml(messageContent)}</b>`;

      let keyboard;
      if (deletedMsg.sender_username && deletedMsg.sender_username.trim() !== "") {
        const profileUrl = `https://t.me/${deletedMsg.sender_username}`;
        keyboard = new InlineKeyboard().url("👤 Profilni ko'rish", profileUrl);
      } else {
        report += `\n\n🔒 <i>Xavfsizlik uchun bu odamning profilini ko'rsata olmaymiz, chunki uning username'i yo'q.</i>`;
        keyboard = undefined;
      }

      try {
        await bot.api.sendMessage(ownerId, report, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (err) {
        console.log("[XATO] Delete xabarini yuborishda:", err.message);
      }
    }
  }
});

// Botni ishga tushirish
bot.start();
