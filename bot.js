// bot.js
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

dotenv.config();

// ---------- Konfiguratsiya ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_PHONE = "+998200012560";
const DOCKON_LOCATION = "https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic";

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("BOT_TOKEN va Supabase o'zgaruvchilari .env da kerak");

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Xotira ----------
const carts = new Map(); // userId -> cart
const userState = new Map(); // userId -> state
const userPhone = new Map(); // userId -> phone

// ---------- Kategoriyalar ----------
const CATEGORIES = [
  { emoji: "🍹", name: "Ichimliklar" },
  { emoji: "🍓", name: "Mevalar" },
  { emoji: "🥕", name: "Sabzavotlar" },
  { emoji: "🍫", name: "Shirinliklar" },
  { emoji: "🍞", name: "Non mahsulotlari" },
  { emoji: "🥩", name: "Kolbasa va go’sht" },
  { emoji: "🧴", name: "Yuvish vositalari" }
];

// ---------- Helper functions ----------
async function getProductsByCategory(categoryName) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("category", categoryName);
  if (error) {
    console.error(error);
    return [];
  }
  return data;
}

function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}

function addOrUpdateCart(userId, item) {
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
    if (ci.unit === "kg") return `• ${ci.name} — ${ci.quantity} kg × ${ci.price/ci.quantity} = ${ci.price} so'm`;
    if (ci.unit === "piece") return `• ${ci.name} — ${ci.quantity} dona × ${ci.price/ci.quantity} = ${ci.price} so'm`;
    if (ci.unit === "sum") return `• ${ci.name} — ${ci.price} so'm`;
  });
  return { lines, total };
}

function clearCart(userId) {
  carts.delete(userId);
}

// ---------- PDF chek yaratish ----------
function createPdf(userId, phone, lines, total) {
  return new Promise((resolve, reject) => {
    const fileName = `check_${userId}_${Date.now()}.pdf`;
    const filePath = path.join("/tmp", fileName);
    const doc = new PDFDocument({ margin: 30 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const date = new Date();
    doc.fontSize(18).text("Buyurtma Cheki", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Telefon: ${phone}`);
    doc.text(`Sana: ${date.toLocaleDateString()}  Vaqt: ${date.toLocaleTimeString()}`);
    doc.moveDown();
    lines.forEach(line => doc.text(line));
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total} so'm`, { align: "right" });
    doc.moveDown();
    doc.fontSize(12).text("Haridingiz uchun rahmat! ❤️", { align: "center" });

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

// ---------- Menyu keyboard ----------
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🛍 Mahsulotlar", "/start"],
    [`📞 Sotuvchi bilan bog‘lanish (${ADMIN_PHONE})`, "🏪 Do‘kon manzili"],
    ["🎁 Maxsus takliflar", "💳 Qarzlarim"]
  ]).resize();
}

// ---------- Start ----------
bot.start(async (ctx) => {
  if (!userPhone.has(ctx.from.id)) {
    await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring:", Markup.keyboard([
      [Markup.button.contactRequest("📱 Telefon raqamni yuborish")]
    ]).resize());
  } else {
    await ctx.reply("Xush kelibsiz!", mainMenuKeyboard());
  }
});

// ---------- Contact handler ----------
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  userPhone.set(ctx.from.id, phone);
  await ctx.reply(`Rahmat! Telefoningiz qabul qilindi: ${phone}`, mainMenuKeyboard());
});

// ---------- Mahsulotlar bo‘limi ----------
bot.hears("🛍 Mahsulotlar", async (ctx) => {
  const buttons = CATEGORIES.map(cat => Markup.button.callback(`${cat.emoji} ${cat.name}`, `cat_${cat.name}`));
  await ctx.reply("Bo‘limni tanlang:", Markup.inlineKeyboard(buttons.map(b => [b])));
});

CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat.name}$`), async (ctx) => {
    await ctx.answerCbQuery();
    const products = await getProductsByCategory(cat.name);
    if (!products.length) return ctx.reply("Bu bo‘limda mahsulotlar yo‘q.");
    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so'm`, `prod_${p.id}`));
    await ctx.reply(`${cat.emoji} ${cat.name} mahsulotlari:`, Markup.inlineKeyboard(buttons.map(b => [b])));
  });
});

// ---------- Product selection ----------
bot.action(/prod_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const productId = ctx.match[1];
  const { data: product } = await supabase.from("products").select("*").eq("id", productId).single();
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  
  if (product.unit === "kg") {
    userState.set(ctx.from.id, { mode: "await_kg_sum", product });
    await ctx.reply(`${product.name} — qancha miqdorda olasiz?\nKG yoki summa kiriting:`);
  } else if (product.unit === "piece") {
    userState.set(ctx.from.id, { mode: "await_piece", product });
    await ctx.reply(`${product.name} — nechta dona olasiz?`);
  }
});

// ---------- Quantity handler ----------
bot.on("text", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state) return;

  const product = state.product;
  let quantity = parseFloat(ctx.message.text.replace(",", ".").replace(/[^0-9.]/g, ""));
  if (isNaN(quantity) || quantity <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting!");
  
  let price = 0;
  let unit = product.unit;
  
  if (state.mode === "await_kg_sum") {
    if (quantity < 1000) { // KG
      unit = "kg";
      price = Math.round(quantity * product.price);
    } else { // Sum
      unit = "sum";
      price = quantity;
    }
  }
  
  if (state.mode === "await_piece") {
    unit = "piece";
    price = quantity * product.price;
  }
  
  addOrUpdateCart(ctx.from.id, { productId: product.id, name: product.name, quantity, unit, price });
  userState.delete(ctx.from.id);
  return ctx.reply(`${product.name} — savatchaga qo‘shildi! Jami: ${price} so'm`);
});

// ---------- Savatcha ko‘rsatish ----------
bot.hears("💳 Qarzlarim", async (ctx) => {
  // supabase dan qarz olishingiz mumkin
  await ctx.reply("Sizning qarzingiz: 0 so'm");
});

bot.hears("🎁 Maxsus takliflar", async (ctx) => {
  await ctx.reply("Hozircha hech narsa yo‘q 😊");
});

bot.hears("🏪 Do‘kon manzili", async (ctx) => {
  await ctx.reply(DOCKON_LOCATION);
});

bot.hears(new RegExp(`📞 Sotuvchi bilan bog‘lanish`), async (ctx) => {
  await ctx.reply(`Telefon: ${ADMIN_PHONE}`);
});

// ---------- Launch ----------
bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
