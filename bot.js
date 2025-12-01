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

function formatCurrency(n) { return Number(n).toLocaleString(); }

function ensureSession(ctx) {
  ctx.session = ctx.session || {};
  if (!ctx.session.cart) ctx.session.cart = [];
  return ctx.session;
}

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

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => 
    Markup.button.callback(`${getCategoryEmoji(c)} ${c}`, `cat_${i}`)
  );
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
  const productButtons = prods.map(p =>
    [Markup.button.callback(`${p.emoji} ${p.name} — ${formatCurrency(p.price)}${p.unit==="kg"? " so'm/kg":" so'm"}`, `product_${p.id}`)]
  );
  // Savat va buyurtma tugmalari kategoriya tagida
  productButtons.push([
    Markup.button.callback("🛒 Savatni ko'rish", "show_cart"),
    Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout")
  ]);
  return Markup.inlineKeyboard(productButtons);
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
      doc.moveDown(0.4);

      lines.forEach(line => doc.fontSize(11).text(line));

      doc.moveDown(0.6);
      doc.fontSize(13).text(`Jami: ${formatCurrency(total)} so'm`, { align: "right" });
      doc.moveDown(1);
      doc.fontSize(11).text("Haridingiz uchun rahmat!", { align: "center" });

      doc.end();
      stream.on("finish", () => resolve(filepath));
      stream.on("error", err => reject(err));
    } catch (err) { reject(err); }
  });
}

function cartSummary(session) {
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if (ci.unit==="piece") return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if (ci.unit==="kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
  });
  return { lines, total };
}

// ---------------- HANDLERS -----------------

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

bot.on("contact", async ctx => {
  ensureSession(ctx);
  const phone = ctx.message?.contact?.phone_number;
  if (phone) {
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else { await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring."); }
});

bot.hears("🍏 Mahsulotlar", async ctx => {
  if (!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

bot.action(/^cat_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  await ctx.reply(`📦 ${CATEGORIES[idx]}:`, productsKeyboardForCategoryIndex(idx));
});

bot.action(/^product_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  ensureSession(ctx);

  if (product.image_url) {
    await ctx.replyWithPhoto(product.image_url, { caption: `${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg"? " so'm/kg":" so'm"}` });
  } else {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg"? " so'm/kg":" so'm"}`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  if (product.unit==="piece") return ctx.reply("Nechta olasiz? (butun son)");
  return ctx.reply("Necha kilogram yoki qancha so'mlik olasiz?");
});

bot.on("text", async ctx => {
  ensureSession(ctx);
  const pending = ctx.session.pending;
  if (!pending) return;

  const product = PRODUCTS.find(p => p.id === pending.productId);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  let txt = ctx.message.text.trim().replace(/,/g,'.');
  let num = parseFloat(txt.replace(/[^0-9.]/g,''));
  if (isNaN(num) || num<=0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");

  let quantity=0, price=0, unitType="";
  if (pending.unit==="piece") {
    quantity=Math.round(num);
    price=product.price*quantity;
    unitType="piece";
  } else {
    if (txt.toLowerCase().includes("so") || txt.toLowerCase().includes("sum") || txt.toLowerCase().includes("so'm")) {
      price=num;
      quantity=+(price/product.price);
      unitType="sum";
    } else {
      quantity=num;
      price=Math.round(quantity*product.price);
      unitType="kg";
    }
  }

  ctx.session.cart.push({ productId: product.id, name: product.name, unit: unitType, unitPrice: product.price, quantity, price, image_url: product.image_url });
  ctx.session.pending=null;

  const { lines, total } = cartSummary(ctx.session);
  await ctx.reply(`${product.name} savatchaga qo‘shildi ✅\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm\n\nHaridlarni davom ettiring👇🏻`, categoriesKeyboard());
});

// SHOW CART
bot.action("show_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");
  await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
  ]));
});

// CLEAR CART
bot.action("clear_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.cart=[];
  await ctx.reply("Savatcha tozalandi ✅");
});

// CHECKOUT
bot.action("start_checkout", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");

  // Yetkazib berish yoki olib ketish
  await ctx.reply("Yetkazib berish yoki olib ketishni tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("🏍️ Yetkazib berish", "delivery"), Markup.button.callback("🏢 Olib ketish", "pickup")]
  ]));
});

bot.action("delivery", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.deliveryType="delivery";
  await ctx.reply("Iltimos lokatsiyangizni yuboring:", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiya yuborish")]
  ]).resize());
});

bot.action("pickup", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.deliveryType="pickup";
  await ctx.reply("Mahsulotlar tayyor! Olib ketishingiz mumkin 👍🏼\nManzil: Do‘kon manzili...");
});

bot.on("location", async ctx => {
  ensureSession(ctx);
  if (!ctx.session.deliveryType || ctx.session.deliveryType!=="delivery") return;
  ctx.session.address=ctx.message.location;
  const { lines, total } = cartSummary(ctx.session);

  const pdfPath = await createOrderPdf({
    userId: ctx.from.id,
    phone: ctx.session.phone,
    lines,
    total,
    deliveryType:"Yetkazib berish",
    address: `${ctx.message.location.latitude}, ${ctx.message.location.longitude}`
  });

  await ctx.replyWithDocument({ source: pdfPath, filename:"Buyurtma_cheki.pdf" });

  await ctx.reply("To‘lov usuli:", Markup.inlineKeyboard([
    [Markup.button.callback("💵 Naqd", "pay_cash")],
    [Markup.button.callback(`💳 Click / Karta raqam`, "pay_card")]
  ]));
});

bot.action("pay_cash", async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply("Naqd to‘lovni amalga oshirish uchun tayyor bo‘ling. To‘lov amalga oshirilgach skrinshotni yuboring.");
});

bot.action("pay_card", async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply(`Karta raqam: ${CARD_NUMBER}\nTo‘lovni amalga oshirib skreenshotini yuboring.`);
});

bot.command("reload_products", async ctx => {
  if (String(ctx.from.id)!==String(ADMIN_ID)) return ctx.reply("Faqat admin.");
  await loadProducts();
  return ctx.reply("Products qayta yuklandi.");
});

bot.catch(console.error);
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
