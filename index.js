require('dotenv').config();
const http = require('http');
const { Bot, InlineKeyboard } = require('grammy');
const Database = require('better-sqlite3');
const messages = require('./messages');

// Bulutli serverlar uchun veb-server (Health Check)
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

// HTML xavfsiz qilish uchun yordamchi funksiyalar
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
    created_at TEXT,
    PRIMARY KEY (message_id, chat_id)
  );

  CREATE TABLE IF NOT EXISTS monitored_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER,
    target_username TEXT,
    last_story_id TEXT,
    created_at TEXT,
    UNIQUE(owner_id, target_username)
  );
`);

// Eski jadvallarga yangi ustunlar qo'shish
try { db.prepare("ALTER TABLE messages ADD COLUMN sender_id INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN created_at TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT").run(); } catch (e) {}

// Akkaunt egasini aniqlash
async function getOwnerId(connectionId) {
  if (!connectionId) return null;
  const row = db.prepare('SELECT user_id FROM business_connections WHERE connection_id = ?').get(connectionId);
  if (row && row.user_id) return row.user_id;

  try {
    const conn = await bot.api.getBusinessConnection(connectionId);
    if (conn && conn.user) {
      const ownerId = conn.user.id;
      db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)').run(connectionId, ownerId);
      return ownerId;
    }
  } catch (err) {
    console.log(`[XATO] getBusinessConnection:`, err.message);
  }
  return null;
}

// Asosiy menyu
function getMainKeyboard() {
  return new InlineKeyboard()
    .text("📱 iPhone", "help_iphone")
    .text("🤖 Android", "help_android")
    .row()
    .text("💻 Desktop (Kompyuter)", "help_desktop")
    .row()
    .text("👁 Tanlangan insonlar", "list_targets")
    .row()
    .text("🎁 Donat (Sovg'a)", "help_donation")
    .text("ℹ️ Bot haqida", "about_bot");
}

// /start va /help buyroqlari
bot.command(['start', 'help'], async (ctx) => {
  const userId = ctx.from.id;
  db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(userId, new Date().toISOString());

  await ctx.reply(messages.startMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard()
  });
});

// Admin statistikasi (/stat)
bot.command('stat', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const usersCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const connectionsCount = db.prepare('SELECT COUNT(*) AS count FROM business_connections').get().count;
  const messagesCount = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
  const targetsCount = db.prepare('SELECT COUNT(*) AS count FROM monitored_users').get().count;

  const statText = `📊 <b>Bot statistikasi:</b>\n\n` +
    `👤 <b>Jami foydalanuvchilar:</b> ${usersCount}\n` +
    `🔗 <b>Faol ulanishlar:</b> ${connectionsCount}\n` +
    `💬 <b>Saqlangan xabarlar:</b> ${messagesCount}\n` +
    `👁 <b>Kuzatuvdagi profillar:</b> ${targetsCount}`;

  await ctx.reply(statText, { parse_mode: 'HTML' });
});

// Admin Reklama yuborish (/broadcast yoki /reklama)
bot.command(['broadcast', 'reklama'], async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const targetMsg = ctx.message.reply_to_message;
  if (!targetMsg) {
    await ctx.reply("⚠️ Reklama yuborish uchun reklama postiga reply qilib <code>/broadcast</code> deb yozing.", { parse_mode: 'HTML' });
    return;
  }

  const users = db.prepare('SELECT user_id FROM users').all();
  let success = 0, failed = 0;

  await ctx.reply(`🚀 Reklama yuborish boshlandi... Jami: ${users.length} ta foydalanuvchi.`);

  for (const user of users) {
    try {
      await bot.api.copyMessage(user.user_id, ctx.chat.id, targetMsg.message_id);
      success++;
    } catch (err) {
      failed++;
    }
  }

  await ctx.reply(`✅ <b>Reklama yakunlandi!</b>\n\n🟢 Yuborildi: ${success}\n🔴 Muvaffaqiyatsiz: ${failed}`, { parse_mode: 'HTML' });
});

// ==========================================
// TANLANGAN INSONLAR (MONITORED USERS) SYSTEM
// ==========================================

// Target qo'shish (/add_target @username)
bot.command('add_target', async (ctx) => {
  const text = ctx.message.text.trim().split(' ');
  if (text.length < 2) {
    return ctx.reply("⚠️ Iltimos, usernameni kiriting.\nMasalan: <code>/add_target @username</code>", { parse_mode: 'HTML' });
  }

  const username = text[1].replace('@', '').toLowerCase();
  try {
    db.prepare('INSERT INTO monitored_users (owner_id, target_username, created_at) VALUES (?, ?, ?)')
      .run(ctx.from.id, username, new Date().toISOString());
    
    await ctx.reply(`✅ <b>@${username}</b> tanlangan insonlar ro'yxatiga qo'shildi! Endi yangi Story joylasa sizga xabar beriladi.`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.reply(`⚠️ <b>@${username}</b> allaqachon ro'yxatingizda mavjud!`, { parse_mode: 'HTML' });
  }
});

// Target o'chirish (/remove_target @username)
bot.command('remove_target', async (ctx) => {
  const text = ctx.message.text.trim().split(' ');
  if (text.length < 2) {
    return ctx.reply("⚠️ Iltimos, usernameni kiriting.\nMasalan: <code>/remove_target @username</code>", { parse_mode: 'HTML' });
  }

  const username = text[1].replace('@', '').toLowerCase();
  const res = db.prepare('DELETE FROM monitored_users WHERE owner_id = ? AND target_username = ?')
    .run(ctx.from.id, username);

  if (res.changes > 0) {
    await ctx.reply(`🗑 <b>@${username}</b> kuzatuv ro'yxatidan olib tashlandi.`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`⚠️ Ro'yxatingizda <b>@${username}</b> topilmadi.`, { parse_mode: 'HTML' });
  }
});

// Ro'yxatni ko'rish (/targets yoki tugma)
async function showTargets(ctx) {
  const list = db.prepare('SELECT target_username FROM monitored_users WHERE owner_id = ?').all(ctx.from.id);
  if (list.length === 0) {
    return ctx.reply("👁 Sizda hali kuzatuvdagi insonlar yo'q.\n\nYangi profil qo'shish uchun: <code>/add_target @username</code> buyrug'ini yuboring.", { parse_mode: 'HTML' });
  }

  let text = "👁 <b>Siz kuzatayotgan insonlar ro'yxati:</b>\n\n";
  list.forEach((item, i) => {
    text += `${i + 1}. @${item.target_username}\n`;
  });
  text += "\n<i>O'chirish uchun: /remove_target @username</i>";

  await ctx.reply(text, { parse_mode: 'HTML' });
}

bot.command('targets', showTargets);
bot.callbackQuery('list_targets', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showTargets(ctx);
});

// ==========================================
// INSTAGRAM STORY DOWNLOADER SYSTEM
// ==========================================

// Foydalanuvchi Instagram Username yuborganda
bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text.trim();

  // Agar buyruq bo'lsa keyingi handlerga o'tkaziladi
  if (text.startsWith('/')) return next();

  if (text.startsWith('@') || !text.includes(' ')) {
    const username = text.replace('@', '').toLowerCase();

    const keyboard = new InlineKeyboard()
      .text("📅 Bugungi Story'lar", `dl_stories_${username}`)
      .row()
      .text("📦 Arxiv (Highlights)", `dl_highlights_${username}`);

    await ctx.reply(`🔍 <b>@${username}</b> profili tanlandi.\n\nQaysi Story'larni yuklab olmoqchisiz?`, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    return;
  }
  return next();
});

// Story yuklash Callback handlerlari
bot.callbackQuery(/^dl_stories_(.+)$/, async (ctx) => {
  const username = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.reply(`📥 <b>@${username}</b> profilining bugungi Story'lari qidirilmoqda...`);
  
  // BU YERDA INSTAGRAM API / RAPIDAPI ORQALI STORY YUKLAB BERILADI
  // Misol uchun notification demo:
  // await ctx.replyWithVideo(videoUrl, { caption: `👤 Profile: @${username}\n📝 Bio: Instagram Profile Bio` });
});

bot.callbackQuery(/^dl_highlights_(.+)$/, async (ctx) => {
  const username = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.reply(`📦 <b>@${username}</b> profilining Arxiv (Highlights) Story'lari yuklanmoqda...`);
});

// ==========================================
// INSTAGRAM MONITORING BACKGROUND WORKER
// ==========================================
setInterval(async () => {
  try {
    const targets = db.prepare('SELECT DISTINCT target_username FROM monitored_users').all();
    for (const target of targets) {
      // Background worker har 5 minutda Instagram API orqali yangi story borligini tekshiradi.
      // Yangi story topilsa, o'sha targetni saqlagan barcha egalariga (owners) bildirishnoma yuboriladi:
      // const owners = db.prepare('SELECT owner_id FROM monitored_users WHERE target_username = ?').all(target.target_username);
      // owners.forEach(o => bot.api.sendMessage(o.owner_id, `🔔 ${target.target_username} yangi story joyladi!`));
    }
  } catch (err) {
    console.log("[BACKGROUND WORKER XATO]:", err.message);
  }
}, 5 * 60 * 1000); // Har 5 daqiqada ishlaydi

// ==========================================
// YO'RIQNOMA TUGMALARI BO'LIMI
// ==========================================
bot.callbackQuery('help_iphone', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  await ctx.reply(messages.helpIphone.replace(/{botUsername}/g, botInfo.username), { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

bot.callbackQuery('help_android', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  await ctx.reply(messages.helpAndroid.replace(/{botUsername}/g, botInfo.username), { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

bot.callbackQuery('help_desktop', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await bot.api.getMe();
  await ctx.reply(messages.helpDesktop.replace(/{botUsername}/g, botInfo.username), { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

bot.callbackQuery('help_donation', async (ctx) => {
  await ctx.answerCallbackQuery();
  const keyboard = new InlineKeyboard()
    .url("🎁 Sovg'a yuborish (@mikhliyevt)", "https://t.me/mikhliyevt")
    .row()
    .text("◀️ Ortga", "back_to_main");

  await ctx.reply(messages.helpDonation, { parse_mode: 'HTML', reply_markup: keyboard });
});

bot.callbackQuery('about_bot', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(messages.aboutBot, { 
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "back_to_main")
  });
});

bot.callbackQuery('back_to_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(messages.startMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard()
  });
});

// ==========================================
// TELEGRAM BUSINESS MESSAGES HANDLERS (ORIGINAL)
// ==========================================
bot.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection;
  if (conn.is_enabled && conn.user) {
    db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)').run(conn.id, conn.user.id);
    db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(conn.user.id, new Date().toISOString());

    try {
      await bot.api.sendMessage(conn.user.id, "✅ <b>Sergak Bot profilingizga muvaffaqiyatli ulandi!</b>\n\nEndi sizga yozib o'chirilgan yoki o'zgartirilgan barcha xabarlar to'g'ridan-to'g'ri shu yerga yetkaziladi.", { parse_mode: 'HTML' });
    } catch (e) {
      console.log("[XATO] Ulanish xabarida:", e.message);
    }
  } else {
    db.prepare('DELETE FROM business_connections WHERE connection_id = ?').run(conn.id);
  }
});

bot.on('business_message', async (ctx) => {
  const msg = ctx.businessMessage;
  const text = msg.text || msg.caption || "[Media fayl / Rasm / Ovozli xabar]";
  const senderName = msg.from ? (msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '')) : "Noma'lum";

  await getOwnerId(msg.business_connection_id);

  const stmtMsg = db.prepare(`
    INSERT OR REPLACE INTO messages (message_id, chat_id, sender_id, sender_name, text, created_at) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmtMsg.run(msg.message_id, msg.chat.id, msg.from ? msg.from.id : 0, senderName, text, new Date().toISOString());
});

bot.on('edited_business_message', async (ctx) => {
  const msg = ctx.editedBusinessMessage;
  const ownerId = await getOwnerId(msg.business_connection_id);
  if (!ownerId) return;

  if (msg.from && msg.from.id === ownerId) return;

  const stmtSelect = db.prepare('SELECT text, sender_id FROM messages WHERE message_id = ? AND chat_id = ?');
  const oldMsg = stmtSelect.get(msg.message_id, msg.chat.id);
  const newText = msg.text || msg.caption || "[Media fayl / Stiker]";
  const senderName = msg.from ? msg.from.first_name : "Suhbatdoshingiz";

  if (oldMsg && oldMsg.text !== newText) {
    const report = `✏️ <b>${escapeHtml(senderName)}</b> xabarni tahrirladi:\n\n⏳ <b>Eski:</b> <s>${escapeHtml(oldMsg.text)}</s>\n🔄 <b>Yangi:</b> <b>${escapeHtml(newText)}</b>`;
    const senderId = (msg.from && msg.from.id) ? msg.from.id : (oldMsg ? oldMsg.sender_id : 0);
    const keyboard = (senderId && senderId !== 0) ? new InlineKeyboard().url("👤 Profilni ko'rish", `tg://user?id=${senderId}`) : undefined;

    try {
      await bot.api.sendMessage(ownerId, report, { parse_mode: 'HTML', reply_markup: keyboard });
    } catch (err) {}
    db.prepare('UPDATE messages SET text = ? WHERE message_id = ? AND chat_id = ?').run(newText, msg.message_id, msg.chat.id);
  }
});

bot.on('deleted_business_messages', async (ctx) => {
  const deletion = ctx.deletedBusinessMessages;
  const ownerId = await getOwnerId(deletion.business_connection_id);
  if (!ownerId) return;

  for (const msgId of deletion.message_ids) {
    const stmtSelect = db.prepare('SELECT sender_id, sender_name, text FROM messages WHERE message_id = ? AND chat_id = ?');
    const deletedMsg = stmtSelect.get(msgId, deletion.chat.id);

    if (deletedMsg) {
      if (deletedMsg.sender_id && deletedMsg.sender_id === ownerId) continue;

      const report = `🗑 <b>${escapeHtml(deletedMsg.sender_name)}</b> xabarni o'chirdi:\n\n📝 <b>O'chirilgan xabar:</b>\n<b>${escapeHtml(deletedMsg.text)}</b>`;
      const keyboard = (deletedMsg.sender_id && deletedMsg.sender_id !== 0) 
        ? new InlineKeyboard().url("👤 Profilni ko'rish", `tg://user?id=${deletedMsg.sender_id}`) 
        : undefined;

      try {
        await bot.api.sendMessage(ownerId, report, { parse_mode: 'HTML', reply_markup: keyboard });
      } catch (err) {}
      
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
