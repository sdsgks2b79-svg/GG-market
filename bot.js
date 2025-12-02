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

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID)
  throw new Error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// GLOBALS
let PRODUCTS = [];
let CATEGORIES = [];

// UTILS
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

// Load products from Supabase
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) {
    console.error(error);
    PRODUCTS = [];
    CATEGORIES = [];
    return;
  }
  PRODUCTS = data.map(p => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit_name,
    category: p.category,
    image_url: p.image_url || null
  }));
  const set = new Set();
  PRODUCTS.forEach(p => set.add(p.category));
  CATEGORIES = Array.from(set);
  console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
}
await loadProducts();

// MAIN MENU
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["🔍 Qidiruv", "/start"]
  ]).resize();
}

// CATEGORY BUTTONS
function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => Markup.button.callback(`${c}`, `cat_${i}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 3));
}

function productsKeyboard(idx) {
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);
  const buttons = prods.map(p => Markup.button.callback(
    `${p.name} — ${formatCurrency(p.price)} ${p.unit==="kg"?"so'm/kg":"so'm"}`,
    `product_${p.id}`
  ));
  buttons.push(Markup.button.callback("🔙 Ortga", `back_main`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}

// PDF CHECK
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
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil / Lokatsiya: ${address}`);
      doc.moveDown();
      doc.fontSize(12).text("Buyurtma tafsiloti:");
      lines.forEach(line => doc.text(line));
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

// CART SUMMARY
function cartSummary(session) {
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if(ci.unit==="piece") return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if(ci.unit==="kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if(ci.unit==="sum") return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
  });
  return { lines, total };
}

// ----------------- HANDLERS -----------------

bot.start(async ctx => {
  ensureSession(ctx);
  if(!ctx.session.phone){
    await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

bot.on("contact", async ctx=>{
  ensureSession(ctx);
  const phone = ctx.message.contact?.phone_number;
  if(phone){
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring.");
  }
});

// Mahsulotlar
bot.hears("🍏 Mahsulotlar", async ctx=>{
  if(!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

// Category
bot.action(/^cat_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  await ctx.reply(`📦 ${CATEGORIES[idx]}`, productsKeyboard(idx));
});

// Back
bot.action("back_main", async ctx=>{
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// Product
bot.action(/^product_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id===pid);
  if(!product) return ctx.reply("Mahsulot topilmadi.");
  ensureSession(ctx);

  if(product.image_url){
    await ctx.replyWithPhoto(product.image_url,{
      caption:`${product.name}\nNarx: ${formatCurrency(product.price)} ${product.unit==="kg"?"so'm/kg":"so'm"}`
    });
  } else {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)} ${product.unit==="kg"?"so'm/kg":"so'm"}`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  const question = product.unit==="piece" ? "Nechta olasiz?" : "Necha kilogram yoki qancha so'mlik olasiz?";
  await ctx.reply(question);
});

// -------- TEXT HANDLER --------
bot.on("text", async ctx=>{
  ensureSession(ctx);
  const txt = ctx.message.text?.trim();

  // ==================== QIDIRUV ====================
  if(ctx.session.awaitingSearch){
    const query = txt.toLowerCase();
    const results = PRODUCTS.filter(p=>p.name.toLowerCase().includes(query));

    if(!results.length){
      ctx.session.awaitingSearch = false;
      return ctx.reply("Hech qanday mahsulot topilmadi 😔");
    }

    const buttons = results.map(p=>Markup.button.callback(
      `${p.name} — ${formatCurrency(p.price)} ${p.unit==="kg"?"so'm/kg":"so'm"}`,
      `product_${p.id}`
    ));
    buttons.push(Markup.button.callback("🔙 Ortga", `back_main`));

    await ctx.reply("Topilgan mahsulotlar:", Markup.inlineKeyboard(chunkButtons(buttons,1)));
    ctx.session.awaitingSearch = false;
    return;
  }

  // Shu yerga avvalgi text handler kodlari qoladi
  // ...
});

// ==================== MAXSUS TAKLIFLAR ====================

bot.hears("🎁 Maxsus takliflar", async ctx=>{
  ensureSession(ctx);

  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('total')
      .eq('user_id', ctx.from.id)
      .gte('created_at', lastMonthStart.toISOString())
      .lt('created_at', lastMonthEnd.toISOString());

    if(error){
      console.error(error);
      return ctx.reply("Xatolik yuz berdi, qayta urinib ko'ring.");
    }

    const totalSpent = orders.reduce((sum,o)=>sum + Number(o.total),0);

    const cashbackPercent = 0.05; // 5%
    const cashbackAmount = Math.floor(totalSpent * cashbackPercent);

    if(cashbackAmount>0){
      await ctx.reply(
        `🎉 Siz o‘tgan oy ${formatCurrency(totalSpent)} so‘mlik savdo qilgansiz.\n` +
        `Kelasi oy uchun ${formatCurrency(cashbackAmount)} so'm cashback olasiz ✅`
      );
    } else {
      await ctx.reply("Hozircha maxsus taklif yo'q 😊");
    }

  } catch(err){
    console.error(err);
    await ctx.reply("Xatolik yuz berdi, qayta urinib ko‘ring.");
  }
});

// Bu yerga qolgan barcha avvalgi bot kodlari (cart, checkout, payment) o‘zgarmasdan qoladi

// Launch
bot.launch()
  .then(()=>console.log("Bot ishga tushdi 🚀"))
  .catch(e=>console.error("Launch error:",e));
