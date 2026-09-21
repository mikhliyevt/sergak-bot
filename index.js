require('dotenv').config();
const http = require('http');
const { Bot, InlineKeyboard } = require('grammy');
const Database = require('better-sqlite3');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🛡 Sergak Bot 24/7 faol ishlamoqda!\n');
}).listen(PORT, () => {
  console.log(`🌐 Server monitoring porti: ${PORT}`);
});

const bot = new Bot(process.env.BOT_TOKEN);
const db = new Database('./messages.db');

// Admin ID raqamini shu yerga yozasiz (O'z Telegram ID raqamingizni qo'ying)
const ADMIN_ID = 123456789; // <-- O'z ID raqamingizni yozing!

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

try { db.prepare("ALTER TABLE messages ADD COLUMN sender_id INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN sender_username TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE messages ADD COLUMN created_at TEXT").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT").run(); } catch (e) {}

async function getOwnerId(connectionId) {
  if (!connectionId) return null;
  const row = db.prepare('SELECT user_id FROM business_connections WHERE connection_id = ?').get(connectionId);
  if (row && row.user_id) return row.user_id;

  try {
    const conn = await bot.api.getBusinessConnection(connectionId);
    if (conn && conn.user) {
      const ownerId = conn.user.id;
      db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)')
        .run(connectionId, ownerId);
      return ownerId;
    }
  } catch (err) {
    console.log(`[XATO] getBusinessConnection xatolik:`, err.message);
  }
  return null;
}

function getMainKeyboard(userId) {
  const keyboard = new InlineKeyboard()
    .text("📱 iPhone", "help_iphone")
    .text("🤖 Android", "help_android")
    .row()
    .text("💻 Desktop (Kompyuter)", "help_desktop")
    .row()
    .text("🎁 Donat (Sovg'a)", "help_donation")
    .text("ℹ️ Bot haqida", "about_bot");

  // Agar foydalanuvchi admin bo'lsa, menyuga Admin Panel tugmasini qo'shamiz
  if (userId === ADMIN_ID) {
    keyboard.row().text("👑 Admin Panel", "admin_panel");
  }

  return keyboard;
}

const startMessage = `
🛡 <b>Sergak Bot</b>ga xush kelibsiz!
Ushbu bot profilingizga ulanib, sizga kelgan va keyinchalik o'chirilgan yoki tahrirlangan barcha xabarlarni maxfiy tarzda yetkazib beradi.
`;

bot.command(['start', 'help'], async (ctx) => {
  const userId = ctx.from.id;
  db.prepare('INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)').run(userId, new Date().toISOString());
  await ctx.reply(startMessage, { parse_mode: 'HTML', reply_markup: getMainKeyboard(userId) });
});

// Admin panel menyusi
bot.callbackQuery('admin_panel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("Siz admin emassiz!");
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("📊 Statistika", "admin_stats")
    .text("📥 Followers (Excel)", "admin_excel")
    .row()
    .text("📢 Reklama tarqatish (Broadcast)", "admin_broadcast")
    .row()
    .text("◀️ Ortga", "back_to_main");

  await ctx.editMessageText("👑 <b>Admin Paneliga xush kelibsiz!</b>\nKerakli bo'limni tanlang:", {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
});

// Statistika
bot.callbackQuery('admin_stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalConnections = db.prepare('SELECT COUNT(*) as count FROM business_connections').get().count;

  const statsText = `
📊 <b>Bot Statistikasi:</b>

👥 Jami foydalanuvchilar: <b>${totalUsers}</b> ta
🔗 Ulangan akkauntlar: <b>${totalConnections}</b> ta
  `;

  await ctx.editMessageText(statsText, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("◀️ Ortga", "admin_panel")
  });
});

// Excel (.csv) formatida yuklab berish
bot.callbackQuery('admin_excel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();

  const users = db.prepare('SELECT user_id, created_at FROM users').all();
  
  let csvContent = "User ID,Registered At\n";
  users.forEach(u => {
    csvContent += `${u.user_id},${u.created_at || 'N/A'}\n`;
  });

  const filePath = './followers.csv';
  fs.writeFileSync(filePath, csvContent);

  await ctx.replyWithDocument(new InputFile(filePath), {
    caption: "📄 Jami foydalanuvchilar ro'yxati (Excel/CSV formatida)"
  });

  fs.unlinkSync(filePath); // Faylni yuborilgach o'chirib tashlaymiz
});

// Reklama tarqatishni boshlash holati (Oddiy xotirada saqlaymiz)
let broadcastMode = false;

bot.callbackQuery('admin_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();

  broadcastMode = true;
  await ctx.reply("📢 <b>Reklama rejimi yoqildi!</b>\n\nIltimos, yubormoqchi bo'lgan xabaringizni (rasm, video, albom yoki matn ko'rinishida) menga yuboring. Men uni darhol barcha foydalanuvchilarga tarqataman.", {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text("❌ Bekor qilish", "admin_panel")
  });
});

// Admin yuborgan reklamani hamma foydalanuvchilarga tarqatish
bot.on('message', async (ctx) => {
  if (ctx.from.id === ADMIN_ID && broadcastMode) {
    broadcastMode = false; // Rejimni o'chiramiz
    const users = db.prepare('SELECT user_id FROM users').all();

    let sentCount = 0;
    let failCount = 0;

    await ctx.reply(`🚀 Reklama tarqatish boshlandi! Jami foydalanuvchilar: ${users.length} ta.`);

    for (const user of users) {
      try {
        // Admindan kelgan istalgan xabarni (rasm, video, matn) foydalanuvchiga nusxalaymiz
        await ctx.copyMessage(user.user_id);
        sentCount++;
      } catch (err) {
        failCount++;
      }
    }

    await ctx.reply(`✅ <b>Reklama tarqatish yakunlandi!</b>\n\n- Muvaffaqiyatli: ${sentCount} ta\n- Xatolik (bloklaganlar): ${failCount} ta`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text("👑 Admin Panelga qaytish", "admin_panel")
    });
    return;
  }
});

bot.callbackQuery('back_to_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(startMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard(ctx.from.id)
  });
});

// Oddiy xabarlar va boshqa eventlar
bot.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection;
  if (conn.is_enabled && conn.user) {
    db.prepare('INSERT OR REPLACE INTO business_connections (connection_id, user_id) VALUES (?, ?)').run(conn.id, conn.user.id);
    await bot.api.sendMessage(conn.user.id, "✅ <b>Sergak Bot muvaffaqiyatli ulandi!</b>", { parse_mode: 'HTML' });
  } else {
    db.prepare('DELETE FROM business_connections WHERE connection_id = ?').run(conn.id);
  }
});

bot.on('business_message', async (ctx) => {
  const msg = ctx.businessMessage;
  if (!msg) return;

  let text = msg.text || msg.caption;
  if (!text) {
    if (msg.photo) text = "[📸 Rasm]";
    else if (msg.video) text = "[🎥 Video]";
    else if (msg.voice) text = "[🎤 Ovozli xabar]";
    else if (msg.audio) text = "[🎵 Audiomaterial]";
    else if (msg.document) text = "[📁 Fayl]";
    else if (msg.sticker) text = "[🏷 Stiker]";
    else text = "[Media fayl]";
  }

  const senderName = msg.from ? (msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '')) : "Noma'lum";
  const senderUsername = msg.from ? msg.from.username : null;

  await getOwnerId(msg.business_connection_id);

  db.prepare(`
    INSERT OR REPLACE INTO messages (message_id, chat_id, sender_id, sender_name, sender_username, text, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msg.message_id, msg.chat.id, msg.from ? msg.from.id : 0, senderName, senderUsername, text, new Date().toISOString());
});

bot.on('edited_business_message', async (ctx) => {
  const msg = ctx.editedBusinessMessage;
  if (!msg) return;

  const ownerId = await getOwnerId(msg.business_connection_id);
  if (!ownerId) return;
  if (msg.from && msg.from.id === ownerId) return;

  const stmtSelect = db.prepare('SELECT text FROM messages WHERE message_id = ? AND chat_id = ?');
  const oldMsg = stmtSelect.get(msg.message_id, msg.chat.id);
  
  let newText = msg.text || msg.caption;
  if (!newText) {
    if (msg.photo) newText = "[📸 Rasm]";
    else if (msg.video) newText = "[🎥 Video]";
    else if (msg.voice) newText = "[🎤 Ovozli xabar]";
    else if (msg.audio) newText = "[🎵 Audiomaterial]";
    else if (msg.document) newText = "[📁 Fayl]";
    else if (msg.sticker) newText = "[🏷 Stiker]";
    else newText = "[Media fayl]";
  }

  const senderName = msg.from ? msg.from.first_name : "Suhbatdoshingiz";
  const senderUsername = msg.from ? msg.from.username : null;
  const oldTextContent = oldMsg ? oldMsg.text : "[Topilmadi]";

  if (oldMsg && oldTextContent !== newText) {
    let report = `<b>${escapeHtml(senderName)}</b> xabarni tahrirladi:\n\n⏳ <b>Eski:</b> <s>${escapeHtml(oldTextContent)}</s>\n🔄 <b>Yangi:</b> <b>${escapeHtml(newText)}</b>`;

    let keyboard;
    if (senderUsername && senderUsername.trim() !== "") {
      keyboard = new InlineKeyboard().url("👤 Profilni ko'rish", `https://t.me/${senderUsername}`);
    } else {
      report += `\n\n🔒 <i>Xavfsizlik uchun bu odamning profilini ko'rsata olmaymiz, chunki uning username'i yo'q.</i>`;
    }

    try {
      await bot.api.sendMessage(ownerId, report, { parse_mode: 'HTML', reply_markup: keyboard });
    } catch (err) {}

    db.prepare('UPDATE messages SET text = ? WHERE message_id = ? AND chat_id = ?').run(newText, msg.message_id, msg.chat.id);
  }
});

bot.on('deleted_business_messages', async (ctx) => {
  const deletion = ctx.deletedBusinessMessages;
  if (!deletion) return;

  const ownerId = await getOwnerId(deletion.business_connection_id);
  if (!ownerId) return;

  for (const msgId of deletion.message_ids) {
    const stmtSelect = db.prepare('SELECT sender_id, sender_name, sender_username, text FROM messages WHERE message_id = ? AND chat_id = ?');
    const deletedMsg = stmtSelect.get(msgId, deletion.chat.id);

    if (deletedMsg) {
      if (deletedMsg.sender_id === ownerId) continue;

      const messageContent = deletedMsg.text || "[Media fayl]";
      let report = `<b>${escapeHtml(deletedMsg.deleted_name || deletedMsg.sender_name)}</b> xabarni o'chirdi:\n\n🗑 <b>O'chirilgan xabar:</b>\n<b>${escapeHtml(messageContent)}</b>`;

      let keyboard;
      if (deletedMsg.sender_username && deletedMsg.sender_username.trim() !== "") {
        keyboard = new InlineKeyboard().url("👤 Profilni ko'rish", `https://t.me/${deletedMsg.sender_username}`);
      } else {
        report += `\n\n🔒 <i>Xavfsizlik uchun bu odamning profilini ko'rsata olmaymiz, chunki uning username'i yo'q.</i>`;
      }

      try {
        await bot.api.sendMessage(ownerId, report, { parse_mode: 'HTML', reply_markup: keyboard });
      } catch (err) {}
    }
  }
});

bot.start();
