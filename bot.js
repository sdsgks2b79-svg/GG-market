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

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);
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

// ---------- Ichki xotira ----------
const carts = new Map();
const userState = new Map();
const userPhone = new Map(); // userId -> phone

// ---------- Helper functions ----------
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
    if (ci.unitType === "sum") return `• ${ci.productName} — ${ci.price.toLocaleString()} so'm`;
  });
  return { lines, total };
}
function chunkButtons(arr, cols = 2) { const out = []; for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols)); return out; }

// ---------- PDF yaratish ----------
function createPdfTempFile(userId, phone, lines, total) {
  return new Promise((resolve, reject) => {
    try {
      const tmpDir = process.env.TMPDIR || "/tmp";
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmpDir, filename);
      const doc = new PDFDocument({ margin: 30 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);
      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Telefon: ${phone || "Ko‘rsatilmagan"}`);
      doc.moveDown();
      lines.forEach(line => doc.text(line));
      doc.moveDown();
      doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });
      doc.end();
      stream.on("finish", () => resolve(filepath));
      stream.on("error", reject);
    } catch (e) { reject(e); }
  });
}

// ---------- Keyboards ----------
function mainMenuKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest("📞 Telefon raqamini jo‘natish")],
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)", "/start"]
  ]).resize();
}
function categoriesInlineKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`)];
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1], `cat_${CATEGORIES[i + 1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(buttons);
}

// ---------- Bot handlers ----------

// /start
bot.start(async (ctx) => {
  try { await ctx.reply("Assalomu alaykum! Telefon raqamingizni jo‘nating.", mainMenuKeyboard()); } catch (e) { console.error(e); }
});

// Telefon raqami qabul qilish
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact?.phone_number;
  if (phone) {
    userPhone.set(ctx.from.id, phone);
    await ctx.reply(`Rahmat! Telefoningiz saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Telefon raqami olingan xato. Qayta yuboring.");
  }
});

// Bo‘limlar
bot.hears("📂 Bo'limlar", async (ctx) => {
  await ctx.reply("Bo‘limlarni tanlang:", categoriesInlineKeyboard());
});

// Inline category
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async (ctx) => {
    await ctx.answerCbQuery();
    const products = PRODUCTS.filter(p => p.category === cat);
    if (!products.length) return ctx.reply("Bu bo'limda mahsulot yo'q.");
    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit === "kg" ? " so'm/kg" : " so'm"}`, `add_${p.id}`));
    buttons.push(Markup.button.callback("🛒 Savatcha", "show_cart"));
    await ctx.reply(`📦 ${cat}:`, Markup.inlineKeyboard(chunkButtons(buttons, 1)));
  });
});

// Mahsulot qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const pid = ctx.match[1];
  const product = findProductById(pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  if (!userPhone.get(ctx.from.id)) return ctx.reply("Iltimos, avval telefon raqamingizni jo‘nating.");
  
  if (product.unit === "piece") {
    userState.set(ctx.from.id, { mode: "await_count", productId: pid });
    return ctx.reply(`Nechta ${product.name} olasiz? (butun son)`);
  }
  if (product.unit === "kg") {
    userState.set(ctx.from.id, { mode: "await_kg", productId: pid });
    return ctx.reply(`Necha kg ${product.name} olasiz?`);
  }
});

// Savatcha
bot.action("show_cart", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const phone = userPhone.get(userId);
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
  await ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\nTelefon: ${phone || "Ko‘rsatilmagan"}\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`);
});

// Buyurtma tasdiqlash
bot.action("confirm_order", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const phone = userPhone.get(userId);
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  try {
    const filePath = await createPdfTempFile(userId, phone, lines, total);
    const adminText = `📦 Yangi buyurtma\nTelefon: ${phone || "Ko‘rsatilmagan"}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID, adminText);
    await bot.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
    await ctx.reply("✅ Buyurtma qabul qilindi! Adminga yuborildi.");
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    try { fs.unlinkSync(filePath); } catch (e) {}
    clearCart(userId);
  } catch (e) {
    console.error(e); return ctx.reply("Buyurtma yaratishda xatolik yuz berdi.");
  }
});

// AI mode
bot.action("ai_mode", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply("Tabiiy tilda yozing: '2ta pepsi va 0.5 kg kartoshka qo‘sh'. AI xato yoki shevada yozilganini ham tushunadi.");
});

// AI text handler
bot.on("text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  const userId = ctx.from.id;
  if (!userPhone.get(userId)) return ctx.reply("Iltimos, avval telefon raqamingizni jo‘nating.");
  if (!openai) return ctx.reply("AI ishlamayapti — OPENAI_API_KEY yoqilmagan.");

  await ctx.reply("AI buyurtmani tahlil qilmoqda... ⏳");
  try {
    const prompt = `
Siz buyurtma parserisiz. Foydalanuvchi matnini o'qib, quyidagi JSON ro'yxatini qaytaring: 
[{"name":"<mahsulot nomi>", "quantity": <son yoki decimal>, "unit": "kg"|"piece"|"sum"} , ...]
Faqat JSON qaytaring, hech qanday izoh yoki boshqa matn bo'lmasin.

Input: ${JSON.stringify(text)}
    `;
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    });
    let content = res.choices?.[0]?.message?.content || "";
    content = content.replace(/^[\s`]*json\r?\n?/i, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || parsed.length === 0) return ctx.reply("AI buyurtmani tushunmadi.");
    for (const it of parsed) {
      const nameLower = (it.name || "").toLowerCase();
      const product = PRODUCTS.find(p => p.name.toLowerCase().includes(nameLower) || nameLower.includes(p.name.toLowerCase()));
      if (!product) continue;
      if (it.unit === "piece") addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "piece", unitPrice: product.price, quantity: Math.max(1, Math.round(it.quantity)), price: product.price * Math.max(1, Math.round(it.quantity)) });
      if (it.unit === "kg") addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "kg", unitPrice: product.price, quantity: it.quantity, price: Math.round(it.quantity * product.price) });
      if (it.unit === "sum") addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "sum", unitPrice: product.price, quantity: it.quantity / product.price, price: it.quantity });
    }
    const { lines, total } = cartSummary(userId);
    return ctx.replyWithMarkdown(`🛍 Savatchaga qo‘shildi:\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`);
  } catch (e) { console.error("AI parse error:", e); return ctx.reply("AI bilan bog‘lanishda xatolik yuz berdi."); }
});

// ---------- Launch ----------
bot.launch().then(() => console.log("Bot ishga tushdi 🚀")).catch(console.error);
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
