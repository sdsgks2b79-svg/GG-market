// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

// ---------- Konfiguratsiya ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "8235655604";
const SHOP_ADDRESS = "Toshkent, Olmazor ko'chasi, 12"; // do‘kon manzili

if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo‘q!");

const bot = new Telegraf(BOT_TOKEN);

// ---------- Ichki xotira ----------
const carts = new Map(); // userId -> cart items
const userState = new Map(); // userId -> { mode, productId }
const userPhones = new Map(); // userId -> phone number
const userDeliveryType = new Map(); // userId -> 'pickup'|'delivery'

// ---------- Mahsulotlar ----------
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg" },
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece" },
  { id: 6, name: "Kolbasa (paket)", price: 50000, unit: "piece" }
];

// ---------- Helper functions ----------
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}

function cartSummary(userId) {
  const cart = ensureCart(userId);
  let total = 0;
  const lines = cart.map(ci => {
    total += ci.price;
    if (ci.unit === "piece") return `• ${ci.name} — ${ci.quantity} dona × ${ci.price / ci.quantity} = ${ci.price} so'm`;
    if (ci.unit === "kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${ci.price / ci.quantity} = ${ci.price} so'm`;
  });
  return { lines, total };
}

function createPdf(userId, lines, total, phone) {
  return new Promise((resolve, reject) => {
    const fileName = `check_${userId}_${Date.now()}.pdf`;
    const filePath = path.join("/tmp", fileName);
    const doc = new PDFDocument({ margin: 30 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Telefon: ${phone}`);
    doc.moveDown();
    lines.forEach(line => doc.text(line));
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total} so'm`, { align: "right" });

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

// ---------- Start command ----------
bot.start((ctx) => {
  const userId = ctx.from.id;
  userState.set(userId, { mode: "await_phone" });
  return ctx.reply("Assalomu alaykum! Buyurtma berish uchun avvalo telefon raqamingizni yuboring.", 
    Markup.keyboard([Markup.button.contactRequest("📱 Telefon raqamni yuborish")]).resize()
  );
});

// ---------- Phone handler ----------
bot.on("contact", (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  userPhones.set(userId, phone);
  userState.delete(userId);
  ctx.reply(`Rahmat! Telefoningiz saqlandi: ${phone}`);
  ctx.reply("Endi bo‘limlardan tanlab buyurtma bera olasiz.", Markup.keyboard([["📂 Bo'limlar", "🛒 Savatcha"]]).resize());
});

// ---------- Bo‘limlar ----------
bot.hears("📂 Bo'limlar", (ctx) => {
  if (!userPhones.has(ctx.from.id)) return ctx.reply("Iltimos avval telefon raqamingizni yuboring!");
  const buttons = PRODUCTS.map(p => Markup.button.callback(`${p.name} — ${p.price}${p.unit==="kg"?" so'm/kg":" so'm"}`, `add_${p.id}`));
  ctx.reply("Mahsulotni tanlang:", Markup.inlineKeyboard(buttons.map(b => [b])));
});

// ---------- Add product ----------
bot.action(/add_(\d+)/, (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return ctx.reply("Mahsulot topilmadi");
  userState.set(ctx.from.id, { mode: product.unit==="kg"?"await_kg":"await_piece", productId });
  ctx.reply(product.unit==="kg"?`Necha kg olasiz?`:`Nechta olasiz?`);
  ctx.answerCbQuery();
});

// ---------- Quantity input ----------
bot.on("text", (ctx) => {
  const userId = ctx.from.id;
  if (!userState.has(userId)) return;
  const state = userState.get(userId);
  const product = PRODUCTS.find(p => p.id === state.productId);
  let qty = parseFloat(ctx.message.text.replace(",", "."));
  if (isNaN(qty) || qty <= 0) return ctx.reply("Iltimos to‘g‘ri qiymat kiriting!");
  const price = Math.round(product.price * qty);
  ensureCart(userId).push({ name: product.name, quantity: qty, price, unit: product.unit });
  userState.delete(userId);
  ctx.reply(`${product.name} savatchaga qo‘shildi ✅`);
});

// ---------- Show cart ----------
bot.hears("🛒 Savatcha", (ctx) => {
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo‘sh!");
  ctx.reply(`Sizning savatchangiz:\n${lines.join("\n")}\nJami: ${total} so'm`, 
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash", "checkout")],
      [Markup.button.callback("🗑️ Tozalash", "clear_cart")]
    ])
  );
});

// ---------- Clear cart ----------
bot.action("clear_cart", (ctx) => {
  carts.delete(ctx.from.id);
  ctx.reply("Savatcha tozalandi ✅");
  ctx.answerCbQuery();
});

// ---------- Checkout ----------
bot.action("checkout", (ctx) => {
  const userId = ctx.from.id;
  userState.set(userId, { mode: "delivery_choice" });
  ctx.reply("Buyurtmani qanday olasiz?", 
    Markup.inlineKeyboard([
      [Markup.button.callback("Olib ketish", "pickup")],
      [Markup.button.callback("Yetkazib berish", "delivery")]
    ])
  );
  ctx.answerCbQuery();
});

// ---------- Delivery / Pickup ----------
bot.action("pickup", async (ctx) => {
  const userId = ctx.from.id;
  userDeliveryType.set(userId, "pickup");
  ctx.reply(`Rahmat! Buyurtmangiz tayyor. Do‘kon manzili: ${SHOP_ADDRESS}`);
  await sendOrderPdf(userId, ctx);
  carts.delete(userId);
  ctx.answerCbQuery();
});

bot.action("delivery", (ctx) => {
  const userId = ctx.from.id;
  userDeliveryType.set(userId, "delivery");
  userState.set(userId, { mode: "await_location" });
  ctx.reply("Iltimos, yetkazib berish uchun joylashuvingizni yuboring", Markup.keyboard([Markup.button.locationRequest("📍 Lokatsiyani yuborish")]).resize());
  ctx.answerCbQuery();
});

// ---------- Location ----------
bot.on("location", async (ctx) => {
  const userId = ctx.from.id;
  if (userState.get(userId)?.mode !== "await_location") return;
  const loc = ctx.message.location;
  await ctx.reply("Lokatsiya qabul qilindi ✅");
  await ctx.telegram.sendMessage(ADMIN_ID, `Mijoz lokatsiyasi: https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`);
  await sendOrderPdf(userId, ctx);
  carts.delete(userId);
  userState.delete(userId);
});

// ---------- Send order PDF ----------
async function sendOrderPdf(userId, ctx) {
  const { lines, total } = cartSummary(userId);
  const phone = userPhones.get(userId) || "Telefon raqam yo'q";
  if (!lines.length) return;
  try {
    const filePath = await createPdf(userId, lines, total, phone);
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma\nTelefon: ${phone}\n${lines.join("\n")}\nJami: ${total} so'm`);
    await ctx.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
    fs.unlinkSync(filePath);
  } catch (e) {
    console.error(e);
    ctx.reply("Buyurtma PDF yaratishda xatolik yuz berdi.");
  }
}

// ---------- Launch ----------
bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
