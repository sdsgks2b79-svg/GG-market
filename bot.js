// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;
const SHOP_ADDRESS = "Manzil: Toshkent, Olmazor ko'chasi 12";

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Mahsulotlar
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "Mevalar" },
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 7, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "Kolbasalar" },
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "Shirinliklar" },
  { id: 9, name: "Non oddiy", price: 4000, unit: "piece", category: "Boshqa" }
];

const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

// In-memory storage
const carts = new Map(); // userId -> [{ productId, productName, unitType, unitPrice, quantity, price }]
const userState = new Map(); // userId -> { mode, productId }
const userPhone = new Map(); // userId -> phone

// Helper functions
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}

function addOrReplaceInCart(userId, item) {
  const cart = ensureCart(userId);
  const idx = cart.findIndex(ci => Number(ci.productId) === Number(item.productId));
  if (idx >= 0) cart[idx] = item;
  else cart.push(item);
}

function cartSummary(userId) {
  const cart = ensureCart(userId);
  let total = 0;
  const lines = cart.map(ci => {
    total += ci.price;
    if (ci.unitType === "piece") return `• ${ci.productName} — ${ci.quantity} dona × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    if (ci.unitType === "kg") return `• ${ci.productName} — ${ci.quantity.toFixed(2)} kg × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    if (ci.unitType === "sum") return `• ${ci.productName} — ${ci.price.toLocaleString()} so'm (pulga qarab)`;
    return `• ${ci.productName} — ${ci.quantity} × ${ci.unitPrice} = ${ci.price}`;
  });
  return { lines, total };
}

// Start command
bot.start(async (ctx) => {
  try {
    // Sticker
    await ctx.replyWithSticker("CAACAgIAAxkBAAEBP9VhZ4bJm4Hm7Bl6qHRo3vGdY8jR9AACFQADwDZPE4wV6wCXXLHgLwQ");

    // Majburiy telefon so‘rash
    await ctx.reply(
      "Assalomu alaykum! Telefon raqamingizni yuboring:",
      Markup.keyboard([[Markup.button.contactRequest("📲 Telefon raqamni yuborish")]])
        .resize()
        .oneTime()
    );
  } catch (e) {
    console.error("Start error:", e);
  }
});

// Telefon qabul qilish
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  userPhone.set(ctx.from.id, phone);
  await ctx.reply(`Telefon raqamingiz qabul qilindi: ${phone}`, Markup.keyboard([
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)"]
  ]).resize());
});

// AI handler
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text || "";

  // Agar foydalanuvchi hali telefon yubormagan bo‘lsa
  if (!userPhone.has(userId)) {
    return ctx.reply("Iltimos avval telefon raqamingizni yuboring.");
  }

  // Bu yerga AI buyurtma qo‘shish kodini yozish mumkin (OpenAI API)
  if (text.toLowerCase().includes("pepsi") || text.toLowerCase().includes("kartoshka")) {
    return ctx.reply("AI tahlil qilmoqda va mahsulotlarni savatchaga qo‘shmoqda... ⏳");
  }

  return ctx.reply("Buyurtmani bo‘limlardan tanlang yoki AI orqali yozing.");
});

// Yetkazib berish / olib ketish
bot.command("order_type", async (ctx) => {
  return ctx.reply(
    "Buyurtma turini tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚚 Yetkazib berish", "delivery")],
      [Markup.button.callback("🏬 Olib ketish", "pickup")]
    ])
  );
});

bot.action("delivery", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Iltimos lokatsiyangizni yuboring:", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yuborish")]
  ]).resize().oneTime());
});

bot.action("pickup", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`Rahmat! Do‘kon manzili: ${SHOP_ADDRESS}`);
});

// Lokatsiyani qabul qilish
bot.on("location", async (ctx) => {
  const loc = ctx.message.location;
  const userId = ctx.from.id;
  const phone = userPhone.get(userId) || "noma’lum";

  // Adminga yuborish
  const adminText = `📦 Yangi buyurtma\nTelefon: ${phone}\nLokatsiya: https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  await bot.telegram.sendMessage(ADMIN_ID, adminText);
  await ctx.reply("Lokatsiyangiz qabul qilindi ✅");
});

bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
