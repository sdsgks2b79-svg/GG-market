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

// Load products
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
}
await loadProducts();

// MAIN MENU
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
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
    const tmp = process.env.TMPDIR || "/tmp";
    const filename = `check_${userId}_${Date.now()}.pdf`;
    const filepath = path.join(tmp, filename);

    const doc = new PDFDocument({ margin: 36 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    const now = new Date();
    doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
    doc.text(`Telefon: ${phone}`);
    if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
    if (address) doc.text(`Manzil: ${address}`);
    doc.moveDown();

    doc.fontSize(12).text("Buyurtma:");
    lines.forEach(line => doc.text(line));
    doc.moveDown(1);

    doc.fontSize(13).text(`Jami: ${formatCurrency(total)} so'm`, { align: "right" });
    doc.end();

    stream.on("finish", () => resolve(filepath));
    stream.on("error", err => reject(err));
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

// ------------------- START -------------------

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
  ctx.session.phone = phone;
  await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
});

// ------------------- PRODUKTLAR -------------------

bot.hears("🍏 Mahsulotlar", async ctx=>{
  if(!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar yo'q");
  await ctx.reply("Bo‘limni tanlang:", categoriesKeyboard());
});

bot.action(/^cat_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  await ctx.reply(`📦 ${CATEGORIES[idx]}`, productsKeyboard(idx));
});

bot.action("back_main", async ctx=>{
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// ------------------- PRODUCT -------------------

bot.action(/^product_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  ensureSession(ctx);

  if(product.image_url){
    await ctx.replyWithPhoto(product.image_url, { caption:`${product.name}\nNarx: ${formatCurrency(product.price)} so'm` });
  } else {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)} so'm`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  await ctx.reply(product.unit==="piece" ? "Nechta olasiz?" : "Necha kilogram yoki qancha so'mlik olasiz?");
});

// ------------------- MIQDOR QABUL -------------------

bot.on("text", async ctx=>{
  ensureSession(ctx);
  const txt = ctx.message.text?.trim();

  if(ctx.session.pending){
    const pending = ctx.session.pending;
    const product = PRODUCTS.find(p => p.id===pending.productId);

    const cleaned = txt.replace(",",".").replace(/[^0-9.,a-zA-Zа-яА-Я]+/g,"");
    const num = parseFloat(cleaned);
    if(isNaN(num) || num<=0) return ctx.reply("To‘g‘ri son kiriting.");

    let quantity=0, price=0, unitType="";

    if(product.unit==="piece"){
      quantity = Math.round(num);
      price = quantity * product.price;
      unitType = "piece";
    }
    else if(product.unit==="kg"){
      const lower = txt.toLowerCase();
      const isKg = lower.includes("kg") || lower.includes("кг");

      if(isKg){
          quantity = num;
          price = quantity * product.price;
          unitType = "kg";
      } else {
          price = num;
          quantity = +(price / product.price);
          unitType = "sum";
      }
    }

    ctx.session.cart.push({
      productId: product.id,
      name: product.name,
      unit: unitType,
      unitPrice: product.price,
      quantity,
      price
    });

    ctx.session.pending=null;
    const { lines,total } = cartSummary(ctx.session);

    await ctx.reply(
      `${product.name} qo‘shildi\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🛒 Savat","show_cart"), Markup.button.callback("✅ Tasdiqlash","start_checkout")]
      ])
    );

    return ctx.reply("Boshqa mahsulot tanlang 👇", categoriesKeyboard());
  }

  // MENU
  switch(txt){
    case "🛒 Savatim":
      const { lines,total } = cartSummary(ctx.session);
      if(!lines.length) return ctx.reply("Savatcha bo‘sh");
      await ctx.reply(
        `Savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Tasdiqlash","start_checkout"), Markup.button.callback("🗑️ Tozalash","clear_cart")]
        ])
      );
      break;

    case "📞 Sotuvchi bilan bog'lanish": return ctx.reply("Telefon: +998200012560");
    case "📍 Do'kon manzili": return ctx.reply("Do'kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
    case "🎁 Maxsus takliflar": return ctx.reply("Hozircha yo‘q");
    case "💳 Qarzlarim": return ctx.reply("Qarzingiz yo‘q");
    default: return ctx.reply("Menyudan tanlang");
  }
});

// ------------------- SAVAT -------------------

bot.action("show_cart", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines,total } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo‘sh");

  await ctx.reply(
    `${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash","start_checkout"), Markup.button.callback("🗑️ Tozalash","clear_cart")]
    ])
  );
});

bot.action("clear_cart", async ctx=>{
  await ctx.answerCbQuery();
  ctx.session.cart = [];
  await ctx.reply("Savatcha tozalandi");
});

// ------------------- CHECKOUT -------------------

bot.action("start_checkout", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo‘sh");

  await ctx.reply(
    "Buyurtmani qanday olasiz?",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚚 Yetkazib berish","choose_delivery_delivery"), Markup.button.callback("🏬 Olib ketish","choose_delivery_pickup")]
    ])
  );
});

// 🚚 YETKAZIB BERISH – **LOKATSIYA SO‘RAYDI**
bot.action("choose_delivery_delivery", async ctx=>{
    await ctx.answerCbQuery();
    ensureSession(ctx);

    ctx.session.checkout = {
        delivery: "delivery",
        address: null
    };

    await ctx.reply(
        "📍 Iltimos lokatsiyangizni yuboring",
        {
            reply_markup: {
                keyboard: [
                    [{ text: "📍 Lokatsiyani yuborish", request_location: true }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    );
});

// MIJOZ LOKATSIYA YUBORGANDA
bot.on("location", async ctx => {
    ensureSession(ctx);

    const lat = ctx.message.location.latitude;
    const lon = ctx.message.location.longitude;
    const googleLink = `https://maps.google.com/?q=${lat},${lon}`;

    ctx.session.checkout.address = googleLink;

    await ctx.reply(
        "🚀 Tez orada ishga tushadi!\nHozircha yetkazib berish xizmati mavjud emas 😊",
        mainMenuKeyboard()
    );
});

// 🏬 PICKUP
bot.action("choose_delivery_pickup", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);

  ctx.session.checkout = {
    delivery:"pickup",
    address:"https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic"
  };

  await ctx.reply(`Do‘kondan olib ketasiz.\nManzil: ${ctx.session.checkout.address}`);
  await askPayment(ctx);
});

// PAYMENT
async function askPayment(ctx){
  await ctx.reply(
    "To‘lov usuli:",
    Markup.inlineKeyboard([
      [Markup.button.callback("💵 Naqd","pay_cash"), Markup.button.callback("💳 Karta","pay_card")]
    ])
  );
}

bot.action("pay_cash", async ctx=>{
  await ctx.answerCbQuery();
  await finalizeOrder(ctx,"Naqd");
});

bot.action("pay_card", async ctx=>{
  await ctx.answerCbQuery();
  await ctx.reply("Karta: 9860 1201 3619 1216\nTo‘lab, skrenshot yuboring.");
});

// ------------------- ORDER YAKUNI -------------------

async function finalizeOrder(ctx,payment){
  ensureSession(ctx);
  const { lines,total } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo‘sh");

  const phone = ctx.session.phone;
  const deliveryType = ctx.session.checkout?.delivery==="pickup" ? "Olib ketish" : "Yetkazib berish";
  const address = ctx.session.checkout?.address || "";

  const pdfPath = await createOrderPdf({
    userId: ctx.from.id,
    phone,
    lines,
    total,
    deliveryType,
    address
  });

  await ctx.replyWithDocument({source: pdfPath, filename: path.basename(pdfPath)});
  await ctx.reply("Buyurtma qabul qilindi!", mainMenuKeyboard());

  const adminText =
    `📦 Yangi buyurtma
Telefon: ${phone}
To'lov: ${payment}
${address ? address+"\n" : ""}
${lines.join("\n")}

Jami: ${formatCurrency(total)} so'm`;

  await bot.telegram.sendMessage(ADMIN_ID, adminText);
  await bot.telegram.sendDocument(ADMIN_ID, {source: pdfPath});

  try { fs.unlinkSync(pdfPath); } catch {}

  ctx.session.cart = [];
  ctx.session.checkout = null;
}

// ------------------- RUN -------------------

bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
