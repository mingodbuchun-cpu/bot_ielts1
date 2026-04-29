require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose    = require('mongoose');
const { User, ReferralLog } = require('./models');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const MONGODB_URI  = process.env.MONGODB_URI  || 'mongodb://localhost:27017/ieltsbot';
const ADMIN_ID     = Number(process.env.ADMIN_CHAT_ID);
const ADMIN_USER   = process.env.ADMIN_USERNAME || 'yuldashev_frontend';
const CHANNEL_1    = process.env.CHANNEL_1  || 'ieltszonefergana';
const CHANNEL_2    = process.env.CHANNEL_2  || 'Ieltszoneferganamock';
const BOT_USERNAME = process.env.BOT_USERNAME || 'YourBotUsername';
const CDI_PRICE    = 30;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB ulandi'))
  .catch(err => { console.error('❌ MongoDB xato:', err); process.exit(1); });

function isAdmin(userId) { return userId === ADMIN_ID; }

function genRefCode() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

async function getOrCreateUser(msg, referralCode = null) {
  const id = msg.from.id;
  let user = await User.findOne({ telegramId: id });
  if (!user) {
    let code;
    do { code = genRefCode(); } while (await User.findOne({ referralCode: code }));
    user = await User.create({
      telegramId:   id,
      username:     msg.from.username   || null,
      firstName:    msg.from.first_name || '',
      lastName:     msg.from.last_name  || '',
      referralCode: code,
    });
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer && referrer.telegramId !== id) {
        user.referredBy = referrer.telegramId;
        await user.save();
      }
    }
    return { user, isNew: true };
  }
  return { user, isNew: false };
}

async function checkSubscription(userId) {
  try {
    const [s1, s2] = await Promise.all([
      bot.getChatMember(`@${CHANNEL_1}`, userId),
      bot.getChatMember(`@${CHANNEL_2}`, userId),
    ]);
    const ok = s => ['member','administrator','creator'].includes(s.status);
    return ok(s1) && ok(s2);
  } catch { return false; }
}

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['🛒 CDI sotib olish', '👤 Hisobim'],
        ['🎁 Ball ishlash'],
      ],
      resize_keyboard: true,
    }
  };
}

function adminMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['👥 Jami userlar', '🏆 Top 15'],
        ['➕ Ball qosh', '➖ Ball ayir'],
        ['🔙 Chiqish'],
      ],
      resize_keyboard: true,
    }
  };
}

async function sendSubscribeMessage(chatId) {
  await bot.sendMessage(chatId,
    `👋 <b>Xush kelibsiz!</b>\n\nBotdan foydalanish uchun quyidagi kanallarga obuna bo'ling:\n\n` +
    `📢 1. @${CHANNEL_1}\n📢 2. @${CHANNEL_2}\n\nObuna bo'lgach, pastdagi <b>✅ Tekshirish</b> tugmasini bosing.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `📢 Kanal 1`, url: `https://t.me/${CHANNEL_1}` },
            { text: `📢 Kanal 2`, url: `https://t.me/${CHANNEL_2}` },
          ],
          [
            { text: '✅ Tekshirish', callback_data: 'check_sub' }
          ]
        ]
      }
    }
  );
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId   = msg.chat.id;
  const refParam = match[1] ? match[1].trim() : null;
  const { user, isNew } = await getOrCreateUser(msg, refParam);

  // Agar avval botda bo'lsa LEKIN kanalga obuna bo'lmagan bo'lsa — subscribe xabar qayta ko'rsin
  if (!isNew && !user.subscribed) {
    await sendSubscribeMessage(chatId);
    return;
  }

  // Avval botda bo'lgan VA obuna bo'lgan — asosiy menyu
  if (!isNew && user.subscribed) {
    await bot.sendMessage(chatId,
      `👋 Qaytib keldingiz, <b>${user.firstName}</b>!\n\nMenulardan foydalaning:`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
    return;
  }

  // Yangi user — subscribe xabar
  await sendSubscribeMessage(chatId);
});

// ─── /adminman ────────────────────────────────────────────────────────────────
bot.onText(/\/adminman/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, '❌ Siz admin emassiz!');
    return;
  }
  await bot.sendMessage(msg.chat.id,
    `🔐 <b>Admin paneliga xush kelibsiz!</b>\n\nKerakli bo'limni tanlang:`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

// ─── Admin tugmalari ──────────────────────────────────────────────────────────
const adminState = new Map();

bot.onText(/👥 Jami userlar/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const count = await User.countDocuments();
  await bot.sendMessage(msg.chat.id,
    `👥 <b>Jami foydalanuvchilar: ${count} ta</b>`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

bot.onText(/🏆 Top 15/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const top = await User.find().sort({ balance: -1 }).limit(15);
  if (!top.length) {
    await bot.sendMessage(msg.chat.id, "Hali foydalanuvchilar yo'q.", adminMenu());
    return;
  }
  const medals = ['🥇','🥈','🥉'];
  let text = `🏆 <b>Top 15 — Eng ko'p ball to'plaganlar</b>\n\n`;
  top.forEach((u, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const name  = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Nomsiz';
    const uname = u.username ? ` @${u.username}` : '';
    text += `${medal} ${name}${uname} — <b>${u.balance} ball</b>\n`;
  });
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', ...adminMenu() });
});

bot.onText(/➕ Ball qosh/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.set(msg.from.id, { action: 'add_ball', step: 'ask_id' });
  await bot.sendMessage(msg.chat.id,
    `➕ <b>Ball qo'shish</b>\n\nFoydalanuvchining Telegram ID sini yuboring:`,
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
  );
});

bot.onText(/➖ Ball ayir/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.set(msg.from.id, { action: 'remove_ball', step: 'ask_id' });
  await bot.sendMessage(msg.chat.id,
    `➖ <b>Ball ayirish</b>\n\nFoydalanuvchining Telegram ID sini yuboring:`,
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
  );
});

bot.onText(/🔙 Chiqish/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  adminState.delete(msg.from.id);
  await bot.sendMessage(msg.chat.id, `✅ Admin paneldan chiqdingiz.`, { parse_mode: 'HTML', ...mainMenu() });
});

// ─── 👤 Hisobim ───────────────────────────────────────────────────────────────
bot.onText(/👤 Hisobim/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  const name  = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz';
  const uname = user.username ? `@${user.username}` : "Yo'q";
  await bot.sendMessage(chatId,
    `👤 <b>Mening hisobim</b>\n\n` +
    `📛 Ism: ${name}\n🔗 Username: ${uname}\n` +
    `💰 Ballar: <b>${user.balance} ball</b>\n` +
    `👥 Taklif qilinganlar: ${user.referralCount} kishi\n` +
    `🛒 CDI xarid: ${user.hasPurchased ? '✅ Xarid qilingan' : '❌ Xarid qilinmagan'}`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// ─── 🎁 Ball ishlash ──────────────────────────────────────────────────────────
bot.onText(/🎁 Ball ishlash/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  const refLink = `https://t.me/${BOT_USERNAME}?start=${user.referralCode}`;
  await bot.sendMessage(chatId,
    `🎁 <b>Do'stlarni taklif qilib ball ishlang!</b>\n\n` +
    `Har bir yangi do'st havola orqali botga qo'shilganda sizga <b>+1 ball</b> beriladi!\n\n` +
    `🔗 <b>Sizning havolangiz:</b>\n<code>${refLink}</code>\n\n` +
    `👥 Taklif qilganlar: <b>${user.referralCount}</b> kishi\n` +
    `💰 Joriy balingiz: <b>${user.balance} ball</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: "📤 Do'stlarga ulashish", switch_inline_query: `IELTS Zone Fergana botiga qo'shiling! ${refLink}` }
        ]]
      }
    }
  );
});

// ─── 🛒 CDI sotib olish ───────────────────────────────────────────────────────
bot.onText(/🛒 CDI sotib olish/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = await User.findOne({ telegramId: msg.from.id });
  if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }
  await bot.sendMessage(chatId,
    `🛒 <b>CDI sotib olish</b>\n\nNarxi: <b>${CDI_PRICE} ball</b>\nSizning balingiz: <b>${user.balance} ball</b>\n\nSotib olishni tasdiqlaysizmi?`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '💳 Sotib olish', callback_data: 'buy_cdi' }]] }
    }
  );
});

// ─── Callback handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data   = query.data;

  if (data === 'check_sub') {
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      await bot.answerCallbackQuery(query.id, { text: 'Iltimos /start bosing.', show_alert: true });
      return;
    }
    const isSub = await checkSubscription(userId);
    if (!isSub) {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Ikkala kanalga ham obuna bo'ling, so'ng tekshiring!",
        show_alert: true
      });
      return;
    }
    await bot.answerCallbackQuery(query.id, { text: '✅ Obuna tasdiqlandi!' });

    user.subscribed = true;
    let bonusText = '';
    if (!user.startBonus) {
      user.balance   += 5;
      user.startBonus = true;
      bonusText = `\n\n🎉 <b>Tabriklaymiz!</b> Kanallarga obuna bo'lganingiz uchun sizga <b>5 ball</b> taqdim qilindi!`;
      if (user.referredBy) {
        const alreadyLogged = await ReferralLog.findOne({ newUserId: userId });
        if (!alreadyLogged) {
          await ReferralLog.create({ referrerId: user.referredBy, newUserId: userId });
          await User.findOneAndUpdate(
            { telegramId: user.referredBy },
            { $inc: { balance: 1, referralCount: 1 } }
          );
          try {
            await bot.sendMessage(user.referredBy,
              `🎁 Siz taklif qilgan do'stingiz botga qo'shildi! Hisobingizga <b>+1 ball</b> qo'shildi.`,
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }
    }
    await user.save();

    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId, message_id: query.message.message_id
      });
    } catch {}

    await bot.sendMessage(chatId,
      `✅ <b>Obuna tasdiqlandi!</b>${bonusText}\n\n💰 Joriy balingiz: <b>${user.balance} ball</b>\n\n👇 Menyudan foydalaning:`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
    return;
  }

  if (data === 'buy_cdi') {
    await bot.answerCallbackQuery(query.id);
    const user = await User.findOne({ telegramId: userId });
    if (!user) { await bot.sendMessage(chatId, 'Iltimos /start ni bosing.'); return; }

    if (user.balance >= CDI_PRICE) {
      user.balance     -= CDI_PRICE;
      user.hasPurchased = true;
      await user.save();
      const name  = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Nomsiz';
      const uname = user.username ? `@${user.username}` : "Yo'q";
      await bot.sendMessage(chatId,
        `✅ <b>Siz xarid qildingiz!</b>\n\nEndi <b>@${ADMIN_USER}</b> ga yozishingiz mumkin.\nQolgan balingiz: <b>${user.balance} ball</b>`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
      try {
        await bot.sendMessage(ADMIN_ID,
          `🛒 <b>Yangi CDI xaridi!</b>\n\n👤 Ism: ${name}\n🔗 Username: ${uname}\n🆔 Telegram ID: <code>${userId}</code>\n📞 Telefon: ${user.phone || 'Kiritilmagan'}\n⏰ Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { console.error('Adminga xabar xato:', e.message); }
    } else {
      const needed = CDI_PRICE - user.balance;
      await bot.sendMessage(chatId,
        `❌ <b>Ball yetarli emas!</b>\n\nKerakli: ${CDI_PRICE} ball\nSizda: ${user.balance} ball\n<b>${needed} ball yetmayabdi</b>\n\n💡 Do'stlarni taklif qilib ball to'plang 👉 🎁 Ball ishlash`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
    }
    return;
  }
});

// ─── Admin holatlari uchun xabar handler ──────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || !isAdmin(msg.from.id)) return;
  const text  = msg.text.trim();
  const state = adminState.get(msg.from.id);
  if (!state) return;

  // Menyu tugmalarini o'tkazish
  const menuButtons = ['👥 Jami userlar','🏆 Top 15','➕ Ball qosh','➖ Ball ayir','🔙 Chiqish',
                       '🛒 CDI sotib olish','👤 Hisobim','🎁 Ball ishlash'];
  if (menuButtons.includes(text) || text.startsWith('/')) return;

  if (state.step === 'ask_id') {
    const targetId = Number(text);
    if (isNaN(targetId)) { await bot.sendMessage(msg.chat.id, "❌ Noto'g'ri ID. Raqam kiriting:"); return; }
    const targetUser = await User.findOne({ telegramId: targetId });
    if (!targetUser) {
      await bot.sendMessage(msg.chat.id, `❌ ID: ${targetId} — foydalanuvchi topilmadi.`, adminMenu());
      adminState.delete(msg.from.id);
      return;
    }
    const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'Nomsiz';
    adminState.set(msg.from.id, { ...state, step: 'ask_amount', targetId, targetName: name });
    await bot.sendMessage(msg.chat.id,
      `👤 <b>${name}</b> (ID: ${targetId})\n💰 Joriy balans: <b>${targetUser.balance} ball</b>\n\nNecha ball ${state.action === 'add_ball' ? "qo'shish" : 'ayirish'}ni kiriting:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (state.step === 'ask_amount') {
    const amount = Number(text);
    if (isNaN(amount) || amount <= 0) { await bot.sendMessage(msg.chat.id, "❌ Noto'g'ri miqdor. Musbat raqam kiriting:"); return; }
    const targetUser = await User.findOne({ telegramId: state.targetId });
    if (!targetUser) {
      await bot.sendMessage(msg.chat.id, '❌ Foydalanuvchi topilmadi.', adminMenu());
      adminState.delete(msg.from.id);
      return;
    }

    if (state.action === 'add_ball') {
      targetUser.balance += amount;
      await targetUser.save();
      await bot.sendMessage(msg.chat.id,
        `✅ <b>${state.targetName}</b> ga <b>+${amount} ball</b> qo'shildi.\n💰 Yangi balans: <b>${targetUser.balance} ball</b>`,
        { parse_mode: 'HTML', ...adminMenu() }
      );
      try { await bot.sendMessage(state.targetId, `🎉 Hisobingizga admin tomonidan <b>+${amount} ball</b> qo'shildi!\n💰 Balansiz: <b>${targetUser.balance} ball</b>`, { parse_mode: 'HTML' }); } catch {}
    } else {
      if (targetUser.balance < amount) {
        await bot.sendMessage(msg.chat.id,
          `❌ Foydalanuvchida faqat <b>${targetUser.balance} ball</b> bor. ${amount} ayirib bo'lmaydi.`,
          { parse_mode: 'HTML', ...adminMenu() }
        );
        adminState.delete(msg.from.id);
        return;
      }
      targetUser.balance -= amount;
      await targetUser.save();
      await bot.sendMessage(msg.chat.id,
        `✅ <b>${state.targetName}</b> dan <b>-${amount} ball</b> ayirildi.\n💰 Yangi balans: <b>${targetUser.balance} ball</b>`,
        { parse_mode: 'HTML', ...adminMenu() }
      );
      try { await bot.sendMessage(state.targetId, `⚠️ Hisobingizdan admin tomonidan <b>-${amount} ball</b> ayirildi.\n💰 Balansiz: <b>${targetUser.balance} ball</b>`, { parse_mode: 'HTML' }); } catch {}
    }
    adminState.delete(msg.from.id);
  }
});

bot.on('polling_error', (err) => console.error('Polling xato:', err.message));
console.log('🤖 Bot ishga tushdi...');