// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "200012560";

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID)
  throw new Error("BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kerak");

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory storage
const carts = new Map(); // userId -> [{ productId, name, quantity, unit, price }]
const userState = new Map(); // userId -> { mode, productId }
const userPhone = new Map(); // userId -> phone
const userLocation = new Map(); // userId -> { lat, lon }

// --- Load products from Supabase ---
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) throw error;
  return data;
}

// --- Helpers ---
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function addToCart(userId, item) {
  const cart = ensureCart(userId);
  const idx = cart.findIndex(ci => ci.productId === item.productId);
  if (idx >= 0) cart[idx] = item;
  else cart.push(item);
}
function cartSummary(userId) {
  const cart = ensureCart(userId);
  let total = 0;
  const lines = cart.map(ci => {
    total += ci.price;
    if (ci.unit === "piece") return `• ${ci.name} — ${ci.quantity} dona × ${ci.price / ci.quantity} = ${ci.price} so'm`;
    if (ci.unit === "kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${ci.price / ci.quantity} = ${ci.price} so'm`;
    if (ci.unit === "sum") return `• ${ci.name} — ${ci.price} so'm (pulga qarab)`;
    return `• ${ci.name} — ${ci.quantity} × ${ci.price / ci.quantity} = ${ci.price}`;
  });
  return { lines, total };
}

// --- PDF ---
function createPdf(userId, lines, total) {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TMPDIR || "/tmp";
    const filename = `check_${userId}_${Date.now()}.pdf`;
    const filepath = path.join(tmpDir, filename);
    const doc = new PDFDocument({ margin: 30 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    doc.fontSize(12).text(`Sana: ${new Date().toLocaleString()}\n`);
    doc.moveDown();
    lines.forEach(line => doc.text(line));
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total} so'm`, { align: "right" });
    doc.moveDown();
    doc.fontSize(12).text("Haridingiz uchun rahmat!");

    doc.end();
    stream.on("finish", () => resolve(filepath));
    stream.on("error", reject);
  });
}

// --- Keyboards ---
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savat", "📞 Sotuvchi bilan bog‘lanish"],
    ["📍 Do‘kon manzili", "⭐ Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

// --- Bot Handlers ---

bot.start(async ctx => {
  const userId = ctx.from.id;
  if (!userPhone.has(userId)) {
    return ctx.reply(
      "Assalomu alaykum! Telefon raqamingizni yuboring:",
      Markup.keyboard([Markup.button.contactRequest("Telefonni yuborish")]).resize()
    );
  } else {
    return ctx.reply("Asosiy menyu:", mainMenuKeyboard());
  }
});

bot.on("contact", ctx => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  userPhone.set(userId, phone);
  ctx.reply("Telefon raqamingiz qabul qilindi ✅", mainMenuKeyboard());
});

// Load products dynamically
let PRODUCTS = [];
let CATEGORIES = [];
async function initProducts() {
  PRODUCTS = await loadProducts();
  const catSet = new Set();
  PRODUCTS.forEach(p => catSet.add(p.category));
  CATEGORIES = Array.from(catSet);
}
initProducts();

// Product menu
bot.hears("🍏 Mahsulotlar", async ctx => {
  const buttons = CATEGORIES.map(c => Markup.button.callback(`📂 ${c}`, `cat_${c}`));
  await ctx.reply("Bo‘limlarni tanlang:", Markup.inlineKeyboard(chunkButtons(buttons, 2)));
});

function chunkButtons(arr, cols = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}

// Category actions
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async ctx => {
    await ctx.answerCbQuery();
    const products = PRODUCTS.filter(p => p.category === cat);
    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price}${p.unit==="kg"? " so'm/kg":" so'm"}`, `add_${p.id}`));
    await ctx.reply(`📦 ${cat}:`, Markup.inlineKeyboard(chunkButtons(buttons, 1)));
  });
});

// Add product to cart
bot.action(/add_(\d+)/, async ctx => {
  await ctx.answerCbQuery();
  const productId = parseInt(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return ctx.reply("Mahsulot topilmadi!");

  if (product.unit === "piece") {
    userState.set(ctx.from.id, { mode: "await_count", productId });
    return ctx.reply(`Nechta ${product.name} olasiz? (butun son)`);
  } else if (product.unit === "kg") {
    userState.set(ctx.from.id, { mode: "await_kg", productId });
    return ctx.reply(`Necha kilogram (${product.name}) olasiz yoki pul summasini kiriting?`);
  }
});

// Text handler for quantity / sum
bot.on("text", async ctx => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (userState.has(userId)) {
    const state = userState.get(userId);
    const product = PRODUCTS.find(p => p.id === state.productId);
    const normalized = parseFloat(text.replace(/,/g, ".").replace(/[^0-9.]/g, ""));
    if (state.mode === "await_count") {
      const cnt = parseInt(text);
      if (isNaN(cnt) || cnt <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");
      addToCart(userId, { productId: product.id, name: product.name, quantity: cnt, unit: "piece", price: product.price * cnt });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${cnt} dona savatchaga qo‘shildi ✅`);
    }
    if (state.mode === "await_kg") {
      if (isNaN(normalized) || normalized <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");
      let price = product.price * normalized;
      addToCart(userId, { productId: product.id, name: product.name, quantity: normalized, unit: "kg", price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${normalized} kg savatchaga qo‘shildi ✅ (yakuniy: ${price} so'm)`);
    }
  }

  // Main menu buttons
  switch (text) {
    case "🛒 Savat":
      const { lines, total } = cartSummary(userId);
      if (!lines.length) return ctx.reply("Savat bo‘sh!");
      return ctx.replyWithMarkdown(`🛍 Savatcha:\n${lines.join("\n")}\n\nJami: ${total} so'm`);
    case "📞 Sotuvchi bilan bog‘lanish":
      return ctx.reply("Sotuvchi bilan bog‘lanish uchun raqam: +998200012560");
    case "📍 Do‘kon manzili":
      return ctx.reply("Do‘kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
    case "⭐ Maxsus takliflar":
      return ctx.reply("Hozircha hech narsa yo‘q 😊");
    case "💳 Qarzlarim":
      return ctx.reply("Sizning qarzingiz yo‘q ✅");
    case "/start":
      return bot.start(ctx);
    default:
      return ctx.reply("Menyudan tanlang yoki mahsulot kiriting.");
  }
});

bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
