// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);

// ---------- SAVAT ----------
const carts = new Map();
const userState = new Map();

// ---------- MAHSULOTLAR ----------
const CATEGORIES = [
  { name: "🍓 Mevalar", products: [{ id: 1, name: "Olma", price: 10000, unit: "kg" }, { id: 2, name: "Banan", price: 12000, unit: "kg" }] },
  { name: "🥦 Sabzavotlar", products: [{ id: 3, name: "Kartoshka", price: 7000, unit: "kg" }, { id: 4, name: "Sabzi", price: 6000, unit: "kg" }] },
  { name: "🥤 Ichimliklar", products: [{ id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece" }, { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece" }] },
  { name: "🍫 Shirinliklar", products: [{ id: 7, name: "Shokolad", price: 20000, unit: "kg" }] },
  { name: "🍞 Non mahsulotlari", products: [{ id: 8, name: "Non oddiy", price: 4000, unit: "piece" }] },
  { name: "🥩 Kolbasa va go‘sht", products: [{ id: 9, name: "Kolbasa", price: 50000, unit: "kg" }] },
  { name: "🧼 Yuvish vositalari", products: [{ id: 10, name: "Sovun", price: 5000, unit: "piece" }] },
];

// ---------- HELPERS ----------
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function clearCart(userId) { carts.delete(userId); }
function findProductById(id) {
  for (const cat of CATEGORIES) { const p = cat.products.find(x => x.id === id); if (p) return p; }
  return null;
}
function addOrReplaceInCart(userId, item) {
  const cart = ensureCart(userId);
  const idx = cart.findIndex(ci => ci.productId === item.productId);
  if (idx >= 0) cart[idx] = item; else cart.push(item);
}
function cartSummary(userId) {
  const cart = ensureCart(userId);
  let total = 0;
  const lines = cart.map(ci => {
    total += ci.price;
    if (ci.unit === "piece") return `${ci.name} — ${ci.quantity} dona × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    if (ci.unit === "kg") return `${ci.name} — ${ci.quantity.toFixed(2)} kg × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    return `${ci.name} — ${ci.price.toLocaleString()} so'm`;
  });
  return { lines, total };
}
function chunkButtons(arr, cols = 3) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}

// ---------- PDF CHECK ----------
function createPdfTempFile(userId, lines, total, phone, deliveryType, address) {
  return new Promise((resolve, reject) => {
    const filename = `check_${userId}_${Date.now()}.pdf`;
    const filepath = path.join("/tmp", filename);
    const doc = new PDFDocument({ margin: 30 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const now = new Date();
    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    doc.fontSize(12).text(`Sana: ${now.toLocaleDateString()}  Vaqt: ${now.toLocaleTimeString()}`);
    doc.text(`Telefon: ${phone}`);
    if(deliveryType) doc.text(`Yetkazib berish: ${deliveryType}`);
    if(address) doc.text(`Manzil: ${address}`);
    doc.moveDown();
    lines.forEach(line => doc.text(line));
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });
    doc.moveDown();
    doc.fontSize(12).text("Haridingiz uchun rahmat!");
    doc.end();
    stream.on("finish", () => resolve(filepath));
    stream.on("error", reject);
  });
}

// ---------- MENYU ----------
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🛍 Mahsulotlar", "🛒 Savatim", "📋 Qarzlarim"],
    ["📍 Do‘kon manzili", "💰 Maxsus takliflar", "📞 Sotuvchi bilan bog‘lanish"],
    ["/start"]
  ]).resize();
}

// ---------- BOT HANDLERS ----------

// /start
bot.start(async (ctx) => {
  const contactKeyboard = Markup.keyboard([
    [Markup.button.contactRequest("📲 Telefon raqamingizni yuboring")]
  ]).resize();
  return ctx.reply("Assalomu alaykum! Iltimos, davom etish uchun telefon raqamingizni yuboring.", contactKeyboard);
});

// Telefon qabul qilish
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  ctx.session = ctx.session || {};
  ctx.session.phone = phone;
  await ctx.reply("Telefon raqamingiz qabul qilindi ✅", mainMenuKeyboard());
});

// Mahsulotlar bo‘limi
bot.hears("🛍 Mahsulotlar", async (ctx) => {
  const buttons = CATEGORIES.map(c => Markup.button.callback(c.name, `cat_${c.name}`));
  const inlineKeyboard = Markup.inlineKeyboard(chunkButtons(buttons, 3));
  await ctx.reply("Bo‘limni tanlang:", inlineKeyboard);
});

// Bo‘limlar
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat.name}$`), async (ctx) => {
    const buttons = cat.products.map(p => Markup.button.callback(
      `${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`,
      `add_${p.id}`
    ));
    buttons.push(Markup.button.callback("🔙 Ortga", "back_to_menu"));
    await ctx.editMessageText(`📦 ${cat.name}:`, Markup.inlineKeyboard(chunkButtons(buttons, 1)));
  });
});

// Mahsulot qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = findProductById(productId);
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  userState.set(ctx.from.id, { mode: "choose_qty", productId });
  if (product.unit === "piece") return ctx.reply(`Nechta ${product.name} olasiz? (dona)`);
  if (product.unit === "kg") return ctx.reply(`Nechta kilogram olasiz yoki qancha so‘mlik olasiz?`);
});

// Mijoz miqdorni yubordi
bot.on("text", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state) return;

  const product = findProductById(state.productId);
  if (!product) return;

  const text = ctx.message.text.replace(",", ".").replace(/[^0-9.]/g, "");
  const number = parseFloat(text);
  if (isNaN(number) || number <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");

  let price, qty, unitType;
  if (product.unit === "piece") {
    qty = Math.round(number);
    price = qty * product.price;
    unitType = "piece";
  } else {
    if (number < product.price) {
      price = Math.round(number);
      qty = price / product.price;
      unitType = "sum";
    } else {
      qty = number;
      price = Math.round(qty * product.price);
      unitType = "kg";
    }
  }

  addOrReplaceInCart(ctx.from.id, { productId: product.id, name: product.name, unitPrice: product.price, quantity: qty, price, unitType });
  userState.delete(ctx.from.id);

  return ctx.reply(`${product.name} — savatchaga qo‘shildi ✅`, mainMenuKeyboard());
});

// Savatni ko‘rsatish
bot.hears("🛒 Savatim", async (ctx) => {
  const { lines, total } = cartSummary(ctx.from.id);
  if (!lines.length) return ctx.reply("Savat bo‘sh!");
  await ctx.reply(lines.join("\n") + `\n\nJami: ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Yakunlash", "finish_order")]
  ]));
});

// Yakunlash
bot.action("finish_order", async (ctx) => {
  return ctx.reply("Yetkazib berish yoki olib ketishni tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "delivery"), Markup.button.callback("🏬 Olib ketish", "pickup")]
  ]));
});

// Yetkazib berish
bot.action("delivery", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.deliveryType = "Yetkazib berish";
  await ctx.reply("Iltimos, lokatsiyangizni jo‘nating 📍", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani jo‘natish")]
  ]).resize());
});

// Lokatsiya
bot.on("location", async (ctx) => {
  const { latitude, longitude } = ctx.message.location;
  ctx.session = ctx.session || {};
  ctx.session.address = `Lat: ${latitude}, Lon: ${longitude}`;

  // Adminga yuborish
  await bot.telegram.sendMessage(ADMIN_ID, `Mijoz lokatsiyasi: Lat:${latitude} Lon:${longitude}`);

  await ctx.reply("Lokatsiyangiz qabul qilindi ✅", mainMenuKeyboard());
});

// Olib ketish
bot.action("pickup", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.deliveryType = "Olib ketish";
  ctx.session.address = "https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic";
  await ctx.reply(`Olib ketish manzili: ${ctx.session.address}`, mainMenuKeyboard());
});

// To‘lov
bot.action(/pay_(cash|click)/, async (ctx) => {
  const type = ctx.match[1] === "cash" ? "Naqd" : "Click";
  await ctx.reply(`✅ Siz ${type} to‘lovni tanladingiz.`);
  await sendOrderPdf(ctx);
});

// PDF yaratish va jo‘natish
async function sendOrderPdf(ctx) {
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return;
  const phone = ctx.session?.phone || "Noma'lum";
  const deliveryType = ctx.session?.deliveryType || "";
  const address = ctx.session?.address || "";
  const filePath = await createPdfTempFile(userId, lines, total, phone, deliveryType, address);

  // Mijozga
  await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
  await ctx.reply("Haridingiz uchun rahmat! ❤️", mainMenuKeyboard());

  // Adminga
  await bot.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });

  clearCart(userId);
}

// Ortga tugma
bot.action("back_to_menu", async (ctx) => {
  return ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// Do‘kon manzili
bot.hears("📍 Do‘kon manzili", async (ctx) => {
  await ctx.reply("Do‘kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
});

// Maxsus takliflar
bot.hears("💰 Maxsus takliflar", async (ctx) => {
  await ctx.reply("Hozircha hech narsa yo‘q 😊");
});

// Sotuvchi bilan bog‘lanish
bot.hears("📞 Sotuvchi bilan bog‘lanish", async (ctx) => {
  await ctx.reply("Sotuvchi bilan bog‘lanish: +998200012560");
});

// Qarzlarim
bot.hears("📋 Qarzlarim", async (ctx) => {
  await ctx.reply("Sizning qarzingiz: 0 so'm");
});

// ---------- BOT LAUNCH ----------
bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
