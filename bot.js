// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

// ---------- Konfiguratsiya ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "200012560"; // admin raqami
const SHOP_LOCATION = "https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic"; // do‘kon lokatsiyasi

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);

// ---------- Mahsulotlar va kategoriyalar ----------
const CATEGORIES = [
  { name: "🍓 Mevalar", key: "mevalar" },
  { name: "🥛 Sut mahsulotlari", key: "sut" },
  { name: "🥤 Ichimliklar", key: "ichimliklar" },
  { name: "🥩 Kolbasalar", key: "kolbasalar" },
  { name: "🍫 Shirinliklar", key: "shirinliklar" },
  { name: "🍞 Boshqa", key: "boshqa" }
];

const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "mevalar" },
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "sut" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "sut" },
  { id: 5, name: "Ichimlik 1.5L", price: 12000, unit: "piece", category: "ichimliklar" },
  { id: 6, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "kolbasalar" },
  { id: 7, name: "Shokolad", price: 20000, unit: "kg", category: "shirinliklar" },
  { id: 8, name: "Non oddiy", price: 4000, unit: "piece", category: "boshqa" }
];

// ---------- Ichki xotira ----------
const carts = new Map(); // userId -> [{ productId, productName, unitType, unitPrice, quantity, price }]
const userState = new Map(); // userId -> { mode, productId }
const userPhone = new Map(); // userId -> telefon raqam
const userDelivery = new Map(); // userId -> "pickup" | "delivery"
const userLocation = new Map(); // userId -> { latitude, longitude }

// ---------- Helper funksiyalar ----------
function ensureCart(userId) { if (!carts.has(userId)) carts.set(userId, []); return carts.get(userId); }
function clearCart(userId) { carts.delete(userId); }
function findProductById(id) { return PRODUCTS.find(p => Number(p.id) === Number(id)); }
function addOrReplaceInCart(userId, item) {
  const cart = ensureCart(userId);
  const idx = cart.findIndex(ci => Number(ci.productId) === Number(item.productId));
  if (idx >= 0) cart[idx] = item; else cart.push(item);
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
function chunkButtons(arr, cols = 2) { const out = []; for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols)); return out; }
function categoriesInlineKeyboard() {
  const buttons = CATEGORIES.map(cat => Markup.button.callback(cat.name, `cat_${cat.key}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 2));
}
function productsKeyboardForCategory(catKey) {
  const products = PRODUCTS.filter(p => p.category === catKey);
  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`, `add_${p.id}`));
  buttons.push(Markup.button.callback("🛒 Savatcha", "show_cart"));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}
function createPdfTempFile(userId, lines, total, phone) {
  return new Promise((resolve, reject) => {
    try {
      const tmpDir = process.env.TMPDIR || "/tmp";
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmpDir, filename);
      const doc = new PDFDocument({ margin: 30 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);
      const now = new Date();
      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Telefon: ${phone || "ko‘rsatilmagan"}`);
      doc.fontSize(12).text(`Sana: ${now.toLocaleDateString()} Vaqt: ${now.toLocaleTimeString()}`);
      doc.moveDown();
      lines.forEach(line => doc.text(line));
      doc.moveDown();
      doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });
      doc.moveDown();
      doc.fontSize(12).text("Haridingiz uchun rahmat! ❤️", { align: "center" });
      doc.end();
      stream.on("finish", () => resolve(filepath));
      stream.on("error", reject);
    } catch (e) { reject(e); }
  });
}

// ---------- Start va menyu ----------
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["/start"]
  ]).resize();
}

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  if (!userPhone.has(userId)) {
    return ctx.reply("Assalomu alaykum! Telefon raqamingizni jo‘nating:", Markup.keyboard([Markup.button.contactRequest("📱 Telefon raqam yuborish")]).resize());
  }
  return ctx.reply("Xush kelibsiz! Bo‘limlardan tanlang:", mainMenuKeyboard());
});

// Telefon qabul qilish
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  if (!ctx.message.contact?.phone_number) return ctx.reply("Telefon raqam topilmadi.");
  userPhone.set(userId, ctx.message.contact.phone_number);
  return ctx.reply("Telefon raqam qabul qilindi ✅", mainMenuKeyboard());
});

// ---------- Kategoriyalar va mahsulotlar ----------
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat.key}$`), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`📦 ${cat.name}:`, productsKeyboardForCategory(cat.key));
  });
});

// Mahsulot qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const productId = ctx.match[1];
  const product = findProductById(productId);
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  if (product.unit === "piece") {
    userState.set(userId, { mode:"await_count", productId });
    return ctx.reply(`Nechta ${product.name} olasiz? (butun son)`);
  }
  if (product.unit === "kg") {
    userState.set(userId, { mode:"await_kg", productId });
    return ctx.reply(`Necha kilogram olasiz? (masalan: 0.5 yoki 1)`);
  }
  return ctx.reply("Noto‘g‘ri birlik.");
});

// Savatcha
bot.action("show_cart", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("🛒 Savatcha bo‘sh!");
  return ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani yakunlash", "checkout")],
    [Markup.button.callback("🗑️ Savatchani tozalash", "clear_cart")]
  ]));
});

// Savatchani tozalash
bot.action("clear_cart", async (ctx) => { await ctx.answerCbQuery(); clearCart(ctx.from.id); return ctx.reply("Savatcha tozalandi ✅"); });

// ---------- Buyurtma yakunlash ----------
bot.action("checkout", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");

  return ctx.reply("Yetkazib berish yoki olib ketish?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "delivery"), Markup.button.callback("🏬 Olib ketish", "pickup")]
  ]));
});

// Yetkazib berish
bot.action("delivery", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userDelivery.set(userId, "delivery");
  return ctx.reply("Lokatsiyani jo‘nating:", Markup.keyboard([Markup.button.locationRequest("📍 Lokatsiyani yuborish")]).resize());
});

// Olib ketish
bot.action("pickup", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userDelivery.set(userId, "pickup");
  const { lines, total } = cartSummary(userId);
  const phone = userPhone.get(userId);
  const filePath = await createPdfTempFile(userId, lines, total, phone);
  await ctx.reply(`Sizning buyurtmangiz qabul qilindi ✅\nDo‘kon manzili: ${SHOP_LOCATION}`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
  await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
  clearCart(userId);
});

// Lokatsiya qabul qilish
bot.on("location", async (ctx) => {
  const userId = ctx.from.id;
  if (userDelivery.get(userId) !== "delivery") return ctx.reply("Iltimos, yetkazib berish tanlang.");
  userLocation.set(userId, { latitude: ctx.message.location.latitude, longitude: ctx.message.location.longitude });
  const { lines, total } = cartSummary(userId);
  const phone = userPhone.get(userId);
  const filePath = await createPdfTempFile(userId, lines, total, phone);
  await ctx.reply("Lokatsiya qabul qilindi ✅ buyurtma adminga yuborildi.");
  // adminga jo‘natish
  await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma\nTelefon: ${phone}\nLokatsiya: https://maps.google.com/?q=${ctx.message.location.latitude},${ctx.message.location.longitude}\nJami: ${total.toLocaleString()} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
  await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
  clearCart(userId);
});

// ---------- Foydalanuvchi raqam va mahsulot soni ----------
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  if (!userPhone.has(userId)) return ctx.reply("Iltimos, telefon raqamingizni yuboring.", Markup.keyboard([Markup.button.contactRequest("📱 Telefon raqam yuborish")]).resize());
  const state = userState.get(userId);
  if (!state) return ctx.reply("Bo‘limlardan mahsulot tanlang yoki savatchani ko‘ring.", mainMenuKeyboard());

  const product = findProductById(state.productId);
  const num = parseFloat(ctx.message.text.replace(",", ".").replace(/[^0-9.]/g, ""));
  if (state.mode === "await_count") {
    if (isNaN(num) || num <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");
    const price = product.price * num;
    addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "piece", unitPrice: product.price, quantity: num, price });
    userState.delete(userId);
    return ctx.reply(`${product.name} — ${num} dona savatchaga qo‘shildi ✅`);
  }
  if (state.mode === "await_kg") {
    if (isNaN(num) || num <= 0) return ctx.reply("Iltimos to‘g‘ri kg kiriting.");
    const price = Math.round(product.price * num);
    addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "kg", unitPrice: product.price, quantity: num, price });
    userState.delete(userId);
    return ctx.reply(`${product.name} — ${num} kg savatchaga qo‘shildi ✅ (yakuniy: ${price.toLocaleString()} so'm)`);
  }
});

// ---------- Bot ishga tushurish ----------
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
