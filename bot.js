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
const CARD_NUMBER = process.env.CARD_NUMBER || "9860120136191216";
const STORE_LOCATION = process.env.STORE_LOCATION || "https://maps.app.goo.gl/8VjBiyPwPGP7nHZZ6?g_st=ic";
const CONTACT_PHONE = process.env.CONTACT_PHONE || "200012560";

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID) {
  throw new Error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let PRODUCTS = [];
let CATEGORIES = [];
let SPECIAL_OFFERS = []; // maxsus takliflar
let USER_DEBTS = {};    // foydalanuvchi qarzlari { phone: amount }

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
    console.error("Supabase products load error:", error);
    PRODUCTS = [];
    CATEGORIES = [];
    return;
  }
  PRODUCTS = data.map(p => ({
    id: Number(p.id),
    name: p.name,
    price: Number(p.price),
    unit: p.unit_name || "piece",
    category: p.category,
    emoji: p.emoji || "🍽️",
    image_url: p.image_url || null
  }));
  const set = new Set();
  PRODUCTS.forEach(p => set.add(p.category));
  CATEGORIES = Array.from(set);
  console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
}
await loadProducts();
setInterval(() => loadProducts().catch(console.error), 1000 * 60 * 5);

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
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil / Lokatsiya: ${address}`);
      doc.moveDown();

      doc.fontSize(12).text("Buyurtma tafsiloti:");
      doc.moveDown(0.4);

      lines.forEach(line => doc.fontSize(11).text(line));

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
    if (ci.unit === "piece") return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if (ci.unit === "kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if (ci.unit === "sum") return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
  });
  return { lines, total };
}

// Keyboards
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => Markup.button.callback(`${getCategoryEmoji(c)} ${c}`, `cat_${i}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 3));
}

function getCategoryEmoji(cat) {
  const map = {
    "Ichimliklar": "🥤",
    "Mevalar": "🍎",
    "Sabzavotlar": "🥕",
    "Shirinliklar": "🍫",
    "Non mahsulotlari": "🥖",
    "Kolbasa va go’sht": "🥩",
    "Yuvish vositalari": "🧴"
  };
  return map[cat] || "🍽️";
}

function productsKeyboardForCategoryIndex(idx) {
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);

  const productButtons = chunkButtons(
    prods.map(p =>
      Markup.button.callback(`${p.emoji} ${p.name} — ${formatCurrency(p.price)}${p.unit==="kg"? " so'm/kg":" so'm"}`, `product_${p.id}`)
    ),
    1 // alohida-alohida
  );

  productButtons.push([
    Markup.button.callback("🛒 Savatni ko'rish", "show_cart"),
    Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout")
  ]);

  return Markup.inlineKeyboard(productButtons);
}

// START
bot.start(async ctx => {
  ensureSession(ctx);
  if (!ctx.session.phone) {
    await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// Contact qabul qilish
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

// Mahsulotlar menyusi
bot.hears("🍏 Mahsulotlar", async ctx => {
  if (!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

// Category
bot.action(/^cat_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  await ctx.reply(`📦 ${CATEGORIES[idx]}:`, productsKeyboardForCategoryIndex(idx));
});

// Product pressed
bot.action(/^product_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  ensureSession(ctx);

  if (product.image_url) {
    await ctx.replyWithPhoto(product.image_url, {
      caption: `${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`
    });
  } else {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  if (product.unit === "piece") return ctx.reply("Nechta olasiz? (butun son)");
  return ctx.reply("Necha kilogram yoki qancha so'mlik olasiz?");
});

// Quantity
bot.on("text", async ctx => {
  ensureSession(ctx);
  const pending = ctx.session.pending;
  if (!pending) return;

  const product = PRODUCTS.find(p => p.id === pending.productId);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  let txt = ctx.message.text.trim().replace(/,/g, '.');
  let num = parseFloat(txt.replace(/[^0-9.]/g, ''));
  if (isNaN(num) || num <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");

  let quantity = 0, price = 0, unitType = "";

  if (pending.unit === "piece") {
    quantity = Math.round(num);
    price = product.price * quantity;
    unitType = "piece";
  } else {
    if (txt.toLowerCase().includes("so") || txt.toLowerCase().includes("sum") || num < product.price) {
      price = Math.round(num);
      quantity = +(price / product.price);
      unitType = "sum";
    } else {
      quantity = num;
      price = Math.round(quantity * product.price);
      unitType = "kg";
    }
  }

  ctx.session.cart.push({
    productId: product.id,
    name: product.name,
    unit: unitType,
    unitPrice: product.price,
    quantity,
    price,
    image_url: product.image_url
  });

  ctx.session.pending = null;

  const { lines, total } = cartSummary(ctx.session);

  await ctx.reply(`${product.name} savatchaga qo‘shildi ✅\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm\n\nHaridlarni davom ettiring👇🏻`, categoriesKeyboard());
});

// Savat va checkout
bot.action("show_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");
  await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
  ]));
});

bot.action("clear_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.cart = [];
  await ctx.reply("Savatcha tozalandi ✅");
});

// Checkout
bot.action("start_checkout", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");

  await ctx.reply("Buyurtmani qanday olmoqchisiz?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "choose_delivery_delivery"), Markup.button.callback("🏬 Olib ketish", "choose_delivery_pickup")]
  ]));
});

// Delivery or pickup
bot.action("choose_delivery_delivery", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout = { delivery: "delivery" };
  await ctx.reply("Iltimos lokatsiyangizni yuboring 📍", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yo'natish")]
  ]).resize());
});

bot.action("choose_delivery_pickup", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout = { delivery: "pickup", address: STORE_LOCATION };
  await ctx.reply(`Mahsulotlar tayyor! Olib ketishingiz mumkin 👍🏼\nManzil: ${STORE_LOCATION}`);
});

// Location
bot.on("location", async ctx => {
  ensureSession(ctx);
  if (!ctx.session.checkout || ctx.session.checkout.delivery !== "delivery") return ctx.reply("Lokatsiyangiz uchun rahmat.");
  const loc = ctx.message.location;
  ctx.session.checkout.address = `Lat:${loc.latitude},Lon:${loc.longitude}`;
  const mapLink = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
  await bot.telegram.sendMessage(ADMIN_ID, `📍 Yangi yetkazib berish buyurtmasi\nTelefon: ${ctx.session.phone}\nLokatsiya: ${mapLink}`);
  await ctx.reply("Lokatsiyangiz qabul qilindi ✅\nTo‘lovni amalga oshirib skreenshotini yuboring");
  ctx.session.pendingPayment = true;
});

// Payment screenshot
bot.on("photo", async ctx => {
  ensureSession(ctx);
  if (ctx.session.pendingPayment) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await bot.telegram.sendPhoto(ADMIN_ID, photo.file_id, { caption: `📸 To‘lov skrinshti\nTelefon: ${ctx.session.phone}` });
    ctx.session.pendingPayment = false;
    await ctx.reply("To‘lov skrinshti qabul qilindi ✅");
  }
});

// Do'kon manzili
bot.hears("📍 Do'kon manzili", async ctx => {
  await ctx.reply(`Do'kon manzili:\n${STORE_LOCATION}`);
});

// Qarzlarim
bot.hears("💳 Qarzlarim", async ctx => {
  ensureSession(ctx);
  const debt = USER_DEBTS[ctx.session.phone] || 0;
  if (debt > 0) {
    await ctx.reply(`Sizning qarzingiz: ${formatCurrency(debt)} so'm`);
  } else {
    await ctx.reply("Sizda qarz yo'q ✅");
  }
});

// Maxsus takliflar
bot.hears("🎁 Maxsus takliflar", async ctx => {
  if (SPECIAL_OFFERS.length) {
    await ctx.reply(`🎁 Maxsus takliflar:\n${SPECIAL_OFFERS.join("\n")}`);
  } else {
    await ctx.reply("Hozircha maxsus taklif yo'q ❌");
  }
});

// Tel raqam
bot.hears("📞 Sotuvchi bilan bog'lanish", async ctx => {
  await ctx.reply(`Sotuvchining raqami: ${CONTACT_PHONE}`);
});

// Admin reload
bot.command("reload_products", async ctx => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.reply("Faqat admin.");
  await loadProducts();
  return ctx.reply("Products qayta yuklandi.");
});

bot.catch(console.error);
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
