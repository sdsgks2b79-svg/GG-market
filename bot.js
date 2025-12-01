// bot.js
import { Telegraf, session, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID;
const CLICK_PAY_URL = process.env.CLICK_PAY_URL || null;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID) {
  throw new Error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let PRODUCTS = [];
let CATEGORIES = [];

function chunkButtons(arr, cols = 3) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}

function formatCurrency(n) {
  return Number(n).toLocaleString();
}

function ensureSession(ctx) {
  ctx.session = ctx.session || {};
  if (!ctx.session.cart) ctx.session.cart = [];
  return ctx.session;
}

// Supabase dan mahsulotlar yuklash
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) {
    console.error("Supabase products load error:", error);
    PRODUCTS = [];
    CATEGORIES = [];
    return;
  }
  PRODUCTS = data.map(p => ({
    id: Number(p.id),
    name: p.name,
    price: Number(p.price),
    unit: p.unit_name, // "piece" yoki "kg"
    category: p.category,
    image_url: p.image_url || null
  }));
  const set = new Set();
  PRODUCTS.forEach(p => set.add(p.category));
  CATEGORIES = Array.from(set);
  console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
}
await loadProducts();
setInterval(() => loadProducts().catch(console.error), 1000 * 60 * 5);

// Menyular
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => Markup.button.callback(`${c}`, `cat_${i}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 3));
}

function productsKeyboardForCategoryIndex(idx) {
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);
  const buttons = prods.map(p => Markup.button.callback(`${p.name} — ${formatCurrency(p.price)}${p.unit==="kg"? " so'm/kg":" so'm"}`, `product_${p.id}`));
  buttons.push(Markup.button.callback("🔙 Ortga", `back_main`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}

// PDF yaratish
function createOrderPdf({ userId, phone, lines, total, deliveryType, address }) {
  return new Promise((resolve, reject) => {
    try {
      const tmp = process.env.TMPDIR || "/tmp";
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmp, filename);

      const doc = new PDFDocument({ margin: 36 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      doc.moveDown(0.5);
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil / Lokatsiya: ${address}`);
      doc.moveDown();

      doc.fontSize(12).text("Buyurtma tafsiloti:");
      doc.moveDown(0.4);

      lines.forEach(line => {
        doc.fontSize(11).text(line);
      });

      doc.moveDown(0.6);
      doc.fontSize(13).text(`Jami: ${formatCurrency(total)} so'm`, { align: "right" });
      doc.moveDown(1);
      doc.fontSize(11).text("Haridingiz uchun rahmat!", { align: "center" });

      doc.end();

      stream.on("finish", () => resolve(filepath));
      stream.on("error", err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// Cart summary
function cartSummary(session) {
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if (ci.unit === "piece") {
      return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    } else if (ci.unit === "kg") {
      return `• ${ci.name} — ${Number(ci.quantity).toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    } else { // sum/fallback
      return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    }
  });
  return { lines, total };
}

// ----------------- Handlers -----------------

bot.start(async ctx => {
  ensureSession(ctx);
  if (!ctx.session.phone) {
    await ctx.reply("Assalomu alaykum! Iltimos, telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamini yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

bot.on("contact", async ctx => {
  ensureSession(ctx);
  const phone = ctx.message?.contact?.phone_number;
  if (phone) {
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring.");
  }
});

// Mahsulotlar
bot.hears("🍏 Mahsulotlar", async ctx => {
  if (!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

bot.action(/^cat_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  if (idx < 0 || idx >= CATEGORIES.length) return ctx.reply("Noto'g'ri bo'lim.");
  await ctx.reply(`📦 ${CATEGORIES[idx]}:`, productsKeyboardForCategoryIndex(idx));
});

bot.action("back_main", async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

bot.action(/^product_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  ensureSession(ctx);
  if (product.image_url) {
    await ctx.replyWithPhoto(product.image_url, {
      caption: `${product.name}\nNarx: ${
