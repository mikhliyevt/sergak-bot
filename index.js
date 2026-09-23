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
const ADMIN_ID = 7967211137;

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
    text TEXT,
    media_type TEXT,
    file_id TEXT,
    created_at TEXT,
    PRIMARY KEY (message_id, chat_id)
  );
`);

// Eski jadvallarga yangi ustunlar qo'shish (agar bo'lmasa)
try { db.prepare("ALTER TABLE messages ADD COLUMN sender_id INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN created_at TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN media_type TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN file_id TEXT").run(); } catch (e) {}

// Akkaunt egasini aniqlash (bazadan yoki Telegram API dan)
async function getOwnerId(connectionId) {
  if (!connectionId) return null;

  const row = db.prepare('SELECT user_id FROM business_connections WHERE connection_id = ?').get(connectionId);
  if (row && row.user_id) {
    return row.user_id;
  }

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

// Media ma'lumotlarini va fayl turini ajratib olish funksiyasi
function extractMediaInfo(msg) {
  let fileId = null;
  let mediaType = null;
  let text = msg.text || msg.caption || '';

  if (msg.photo) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    mediaType = 'photo';
  } else if (msg.video) {
    fileId = msg.video.file_id;
    mediaType = 'video';
  } else if (msg.voice) {
    fileId = msg.voice.file_id;
    mediaType = 'voice';
  } else if (msg.audio) {
    fileId = msg.audio.file_id;
    mediaType = 'audio';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    mediaType = 'document';
  } else if (msg.video_note) {
    fileId = msg.video_note.file_id;
    mediaType = 'video_note';
  } else if (msg.sticker) {
    fileId = msg.sticker.file_id;
    mediaType = 'sticker';
  }

  return { fileId, mediaType, text };
}

// Mediani foydalanuvchiga qayta yuboruvchi yordamchi funksiya
async function sendMediaReport(ownerId, reportText, mediaType, fileId, keyboard) {
  const options = { parse_mode: 'HTML', reply_markup: keyboard };

  if (!fileId || !mediaType) {
    await bot.api.sendMessage(ownerId, reportText, options);
    return;
  }

  options.caption = reportText;

  switch (mediaType) {
    case 'photo':
      await bot.api.sendPhoto(ownerId, fileId, options);
      break;
    case 'video':
      await bot.api.sendVideo(ownerId, fileId, options);
      break;
    case 'voice':
      await bot.api.sendVoice(ownerId, fileId, options);
      break;
    case 'audio':
      await bot.api.sendAudio(ownerId, fileId, options);
      break;
    case 'document':
      await bot.api.sendDocument(ownerId, fileId, options);
      break;
    case 'video_note':
      await bot.api.sendMessage(ownerId, reportText, { parse_mode: 'HTML' });
      await bot.api.sendVideoNote(ownerId, fileId, { reply_markup: keyboard });
      break;
    case 'sticker':
      await bot.api.sendMessage(ownerId, reportText, { parse_mode: 'HTML' });
      await bot.api.sendSticker(ownerId, fileId, { reply_markup: keyboard });
      break;
    default:
      await bot.api.sendMessage(ownerId, reportText, options);
      break;
  }
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

// Admin Statistikasi buyrug'i (/stat)
bot.command('stat', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const usersCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const connectionsCount = db.prepare('SELECT COUNT(*) AS count FROM business_connections').get().count;
  const messagesCount = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;

  const statText = `📊 <b>Bot statistikasi:</b>\n\n` +
    `👤 <b>Jami foydalanuvchilar:</b> ${usersCount}\n` +
    `🔗 <b>Faol ulanishlar:</b> ${connectionsCount}\n` +
    `💬 <b>Saqlangan xabarlar:</b> ${messagesCount}`;

  await ctx.reply(statText, { parse_mode: 'HTML' });
});

// Admin Reklama yuborish buyrug'i (/broadcast yoki /reklama)
bot.command(['broadcast', 'reklama'], async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const targetMsg = ctx.message.reply_to_message;
  if (!targetMsg) {
    await ctx.reply("⚠️ Reklama yuborish uchun reklama postiga (rasm, video yoki matn) <b>reply</b> qilib <code>/broadcast</code> deb yozing.", { parse_mode: 'HTML' });
    return;
  }

  const users = db.prepare('SELECT user_id FROM users').all();
  let success = 0;
  let failed = 0;

  await ctx.reply(`🚀 Reklama yuborish boshlandi... Jami: ${users.length} ta foydalanuvchi.`);

  for (const user of users) {
    try {
      await bot.api.copyMessage(user.user_id, ctx.chat.id, targetMsg.message_id);
      success++;
    } catch (err) {
      failed++;
    }
  }

  await ctx.reply(`✅ <b>Reklama yakunlandi!</b>\n\n🟢 Yuborildi: ${success}\n🔴 Muvaffaqiyatsiz (bloklagan): ${failed}`, { parse_mode: 'HTML' });
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
3. Agar suhbatdosh xabarni <b>tahrirlasa (edit)</b> yoki <b>o'chirsa (delete)</b>, bot darhol asl matnni yoki faylni (rasm/video) sizga yetkazadi.
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

  if (conn.is_enabled && conn.user) {
    db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)').run(conn.id, conn.user.id);
    db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(conn.user.id, new Date().toISOString());

    try {
      await bot.api.sendMessage(conn.user.id, "✅ <b>Sergak Bot profilingizga muvaffaqiyatli ulandi!</b>\n\nEndi sizga yozib o'chirilgan yoki o'zgartirilgan barcha xabarlar va fayllar to'g'ridan-to'g'ri shu yerga yetkaziladi. Xizmatdan bepul va cheksiz foydalanishingiz mumkin!", {
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
  const { fileId, mediaType, text } = extractMediaInfo(msg);

  const senderId = (msg.from && msg.from.id) ? msg.from.id : msg.chat.id;
  const senderName = msg.from 
    ? (msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '')) 
    : (msg.chat && msg.chat.first_name ? msg.chat.first_name : "Suhbatdosh");

  await getOwnerId(msg.business_connection_id);

  const stmtMsg = db.prepare(`
    INSERT OR REPLACE INTO messages (message_id, chat_id, sender_id, sender_name, text, media_type, file_id, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtMsg.run(msg.message_id, msg.chat.id, senderId, senderName, text, mediaType, fileId, new Date().toISOString());
});

// Xabar tahrirlanganda (Edit)
bot.on('edited_business_message', async (ctx) => {
  const msg = ctx.editedBusinessMessage;
  
  const ownerId = await getOwnerId(msg.business_connection_id);
  if (!ownerId) return;

  const senderId = (msg.from && msg.from.id) ? msg.from.id : msg.chat.id;

  // Akkaunt egasining o'zi edit qilgan bo'lsa
  if (senderId === ownerId) return;

  const stmtSelect = db.prepare('SELECT text, media_type, file_id, sender_id, sender_name FROM messages WHERE message_id = ? AND chat_id = ?');
  const oldMsg = stmtSelect.get(msg.message_id, msg.chat.id);
  const { fileId: newFileId, mediaType: newMediaType, text: newText } = extractMediaInfo(msg);
  
  const senderName = (msg.from && msg.from.first_name) 
    ? msg.from.first_name 
    : (oldMsg && oldMsg.sender_name ? oldMsg.sender_name : "Suhbatdoshingiz");

  if (oldMsg && (oldMsg.text !== newText || oldMsg.file_id !== newFileId)) {
    let report = `✏️ <b>${escapeHtml(senderName)}</b> xabarni tahrirladi:\n\n`;
    
    if (oldMsg.text) {
      report += `⏳ <b>Eski matn:</b> <s>${escapeHtml(oldMsg.text)}</s>\n`;
    }
    if (newText) {
      report += `🔄 <b>Yangi matn:</b> <b>${escapeHtml(newText)}</b>`;
    }

    const targetUserId = senderId || (oldMsg ? oldMsg.sender_id : msg.chat.id);
    const keyboard = targetUserId ? new InlineKeyboard().url("👤 Profilni ko'rish", `tg://user?id=${targetUserId}`) : undefined;

    try {
      await sendMediaReport(ownerId, report, oldMsg.media_type, oldMsg.file_id, keyboard);
    } catch (err) {
      console.log("[XATO] Edit xabarini yuborishda:", err.message);
    }
    
    db.prepare('UPDATE messages SET text = ?, media_type = ?, file_id = ? WHERE message_id = ? AND chat_id = ?')
      .run(newText, newMediaType, newFileId, msg.message_id, msg.chat.id);
  }
});

// Xabar o'chirilganda (Delete)
bot.on('deleted_business_messages', async (ctx) => {
  const deletion = ctx.deletedBusinessMessages;
  
  const ownerId = await getOwnerId(deletion.business_connection_id);
  if (!ownerId) return;

  for (const msgId of deletion.message_ids) {
    const stmtSelect = db.prepare('SELECT sender_id, sender_name, text, media_type, file_id FROM messages WHERE message_id = ? AND chat_id = ?');
    const deletedMsg = stmtSelect.get(msgId, deletion.chat.id);

    if (deletedMsg) {
      // Akkaunt egasi o'zi o'chirgan bo'lsa
      if (deletedMsg.sender_id && deletedMsg.sender_id === ownerId) continue;

      let report = `🗑 <b>${escapeHtml(deletedMsg.sender_name)}</b> xabarni o'chirdi:\n\n`;
      if (deletedMsg.text) {
        report += `📝 <b>O'chirilgan xabar matni:</b>\n<b>${escapeHtml(deletedMsg.text)}</b>`;
      } else if (deletedMsg.media_type) {
        report += `📁 <b>O'chirilgan media fayl (${deletedMsg.media_type})</b>`;
      }

      const targetUserId = deletedMsg.sender_id || deletion.chat.id;
      const keyboard = targetUserId ? new InlineKeyboard().url("👤 Profilni ko'rish", `tg://user?id=${targetUserId}`) : undefined;

      try {
        await sendMediaReport(ownerId, report, deletedMsg.media_type, deletedMsg.file_id, keyboard);
      } catch (err) {
        console.log("[XATO] Delete xabarini yuborishda:", err.message);
      }
      
      db.prepare('DELETE FROM messages WHERE message_id = ? AND chat_id = ?').run(msgId, deletion.chat.id);
    }
  }
});

bot.catch((err) => console.log("[XATO ushlandi]:", err.message));

bot.start({
  drop_pending_updates: false,
  onStart: (botInfo) => {
    console.log(`🛡 Sergak Bot (@${botInfo.username}) to'liq BEPUL rejimda ishga tushdi!`);
  }
});
