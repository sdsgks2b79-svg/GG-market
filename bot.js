// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// ---------- Konfiguratsiya ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;
const SHOP_ADDRESS = "GG Market manzili: Toshkent, Chilonzor 10-uy";

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID .env da kerak");

// OpenAI
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ---------- Mahsulotlar ----------
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "Mevalar" },
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 7, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "Kolbasalar" },
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "Shirinliklar" },
  { id: 9, name: "Non oddiy", price: 4000, unit: "piece", category: "Boshqa" }
];

const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

// ---------- In-memory storage ----------
const carts = new Map(); // userId -> items
const userState = new Map(); // userId -> state {mode, productId}

// ---------- Helper functions ----------
function ensureCart(userId) { if (!carts.has(userId)) carts.set(userId, []); return carts.get(userId); }
function clearCart(userId) { carts.delete(userId); }
function findProductById(id) { return PRODUCTS.find(p => p.id === Number(id)); }
function addOrReplaceInCart(userId, item) {
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
    if (ci.unitType === "piece") return `• ${ci.productName} — ${ci.quantity} dona × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    if (ci.unitType === "kg") return `• ${ci.productName} — ${ci.quantity.toFixed(2)} kg × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
    if (ci.unitType === "sum") return `• ${ci.productName} — ${ci.price.toLocaleString()} so'm (pulga qarab)`;
    return `• ${ci.productName} — ${ci.quantity} × ${ci.unitPrice} = ${ci.price}`;
  });
  return { lines, total };
}

// PDF
function createPdfTempFile(userPhone, lines, total) {
  return new Promise((resolve, reject) => {
    try {
      const tmpDir = process.env.TMPDIR || "/tmp";
      const filename = `check_${userPhone}_${Date.now()}.pdf`;
      const filepath = path.join(tmpDir, filename);
      const doc = new PDFDocument({ margin: 30 });
      doc.pipe(fs.createWriteStream(filepath));
      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" }).moveDown();
      doc.fontSize(12).text(`Telefon: ${userPhone}`).moveDown();
      lines.forEach(line => doc.text(line));
      doc.moveDown();
      doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });
      doc.end();
      resolve(filepath);
    } catch (e) { reject(e); }
  });
}

// AI parse
async function aiParseOrderText(text) {
  if (!openai) return [];
  const prompt = `Foydalanuvchi buyurtmasini JSON ga o'zgartiring. Format: [{"name":"<mahsulot>", "quantity":<son>, "unit":"kg"|"piece"|"sum"}]. Faqat JSON. Input: ${text}`;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    });
    const content = res.choices?.[0]?.message?.content || "[]";
    return JSON.parse(content.replace(/```/g, "").trim());
  } catch (e) {
    console.error(e); return [];
  }
}

// ---------- Keyboards ----------
function mainMenuKeyboard() {
  return Markup.keyboard([["📂 Bo'limlar", "🛒 Savatcha"], ["💡 Suniy intelekt (AI)"], [Markup.button.requestContact("📱 Telefonni yuborish")]]).resize();
}
function categoriesInlineKeyboard() {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`)];
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1], `cat_${CATEGORIES[i + 1]}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(rows);
}

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// Majburiy telefon
bot.start(ctx => ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring 📱", mainMenuKeyboard()));
bot.on("contact", ctx => {
  const phone = ctx.message.contact.phone_number;
  ctx.from.phone = phone; // attach to user object
  ctx.reply(`Rahmat! Telefoningiz qabul qilindi: ${phone}`, mainMenuKeyboard());
});

// Category actions
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async ctx => {
    await ctx.answerCbQuery();
    const products = PRODUCTS.filter(p => p.category === cat);
    if (!products.length) return ctx.reply("Bu bo'limda mahsulot yo'q");
    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`, `add_${p.id}`));
    buttons.push(Markup.button.callback("🛒 Savatcha", "show_cart"));
    ctx.reply(`📦 ${cat}:`, Markup.inlineKeyboard(chunkButtons(buttons,1)));
  });
});

// Add to cart handler (kg/piece/sum) & AI auto parse logic
// ... shu qismni avvalgi koddagi kabi davom ettiring (userState bilan)

// Confirm order
bot.action("confirm_order", async ctx => {
  await ctx.answerCbQuery();
  const userPhone = ctx.from.phone || "Telefon raqam ko‘rsatilmagan";
  const { lines, total } = cartSummary(ctx.from.id);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  try {
    const filePath = await createPdfTempFile(userPhone, lines, total);
    const adminText = `📦 Yangi buyurtma\nTelefon: ${userPhone}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID, adminText);
    await bot.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
    await ctx.reply("✅ Buyurtma qabul qilindi! Adminga yuborildi.");
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    clearCart(ctx.from.id);
  } catch(e){console.error(e); ctx.reply("Buyurtma yaratishda xatolik yuz berdi");}
});

// Yetkazib berish / Olib ketish tugmalari
bot.action("delivery_pickup", async ctx => {
  await ctx.answerCbQuery();
  ctx.reply("Tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "delivery"), Markup.button.callback("🏪 Olib ketish", "pickup")]
  ]));
});

bot.action("delivery", async ctx => {
  await ctx.answerCbQuery();
  ctx.reply("📍 Lokatsiyangizni yuboring:", Markup.keyboard([Markup.button.locationRequest("Lokatsiyani yuborish")]).resize());
});

bot.on("location", async ctx => {
  const loc = ctx.message.location;
  const userPhone = ctx.from.phone || "Telefon raqam ko‘rsatilmagan";
  const msg = `📦 Buyurtma lokatsiyasi:\nTelefon: ${userPhone}\nLatitude: ${loc.latitude}, Longitude: ${loc.longitude}`;
  await bot.telegram.sendMessage(ADMIN_ID, msg);
  ctx.reply("Rahmat! Buyurtmangiz qabul qilindi ✅");
});

bot.action("pickup", async ctx => {
  await ctx.answerCbQuery();
  ctx.reply(`Rahmat! Buyurtmangiz tayyor ✅\nDo‘konga kelish manzili:\n${SHOP_ADDRESS}`);
});

// ---------- Launch ----------
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"))
process.once("SIGINT", ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
