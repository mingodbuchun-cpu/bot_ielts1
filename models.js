const mongoose = require('mongoose');

// ─── User Schema ───────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username:   { type: String, default: null },
  firstName:  { type: String, default: '' },
  lastName:   { type: String, default: '' },
  phone:      { type: String, default: null },

  // Ballar
  balance: { type: Number, default: 0 },

  // Referral
  referralCode:    { type: String, unique: true },   // o'zining kodi
  referredBy:      { type: Number, default: null },  // kim taklif qildi (telegramId)
  referralCount:   { type: Number, default: 0 },     // nechta kishi taklif qildi

  // Kanalga obuna holati
  subscribed:  { type: Boolean, default: false },
  startBonus:  { type: Boolean, default: false },    // 5 ball bir marta berildi

  // CDI xarid
  hasPurchased: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

// ─── Referral Log (kim kimni taklif qildi, ikki marta hisoblanmasin) ───────────
const referralLogSchema = new mongoose.Schema({
  referrerId: { type: Number, required: true },  // bal oluvchi
  newUserId:  { type: Number, required: true, unique: true }, // yangi foydalanuvchi
  createdAt:  { type: Date, default: Date.now },
});

const User       = mongoose.model('User', userSchema);
const ReferralLog = mongoose.model('ReferralLog', referralLogSchema);

module.exports = { User, ReferralLog };