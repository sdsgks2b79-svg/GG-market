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
const ADMIN_ID = process.env.ADMIN_ID || "8235655604";
const SHOP_ADDRESS = "GG Market do‘koni: Toshkent sh., Amir Temur ko‘chasi 10";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN muhim, environment ga qo‘ying!");
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ---------- Mahsulotlar ----------
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "Mevalar 🍎" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "Mevalar 🍎" },
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "Sut mahsulotlari 🥛" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "Sut mahsulotlari 🥛" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "Ichimliklar 🥤" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "Ichimliklar 🥤" },
  { id: 7, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "Kolbasalar 🥩" },
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "Shirinliklar 🍫" },
  { id: 9, name: "Non oddiy", price: 4000, unit: "piece", category: "Boshqa 🛍" }
];
const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

// ---------- Ichki xotira ----------
const carts = new Map();      // userId -> [item]
const userState = new Map();  // userId -> { mode, productId, phone, deliveryType }

// ---------- Helper funksiyalar ----------
function ensureCart(userId) { if (!carts.has(userId)) carts.set(userId, []); return carts.get(userId); }
function clearCart(userId) { carts.delete(userId); }
function findProductById(id) { return PRODUCTS.find(p => Number(p.id) === Number(id)); }
function addOrReplaceInCart(userId, item) {
  const cart = ensureCart(userId);
  const idx = cart.findIndex(ci => Number(ci.productId) === Number(item.productId));
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
function chunkButtons(arr, cols = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}
function productsKeyboardForCategory(cat) {
  const products = PRODUCTS.filter(p => p.category === cat);
  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit === "kg" ? " so'm/kg" : " so'm"}`, `add_${p.id}`));
  buttons.push(Markup.button.callback("🛒 Savatcha", "show_cart"));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}

// PDF yaratish
function createPdfTempFile(userPhone, lines, total) {
  return new Promise((resolve, reject) => {
    try {
      const tmpDir = process.env.TMPDIR || "/tmp";
      const filename = `check_${userPhone}_${Date.now()}.pdf`;
      const filepath = path.join(tmpDir, filename);
      const doc = new PDFDocument({ margin: 30 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Telefon: ${userPhone || "ko‘rsatilmagan"}`);
      doc.moveDown();

      lines.forEach(line => doc.fontSize(12).text(line));
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
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)", "/start"]
  ]).resize();
}
function categoriesInlineKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`)];
    if (CATEGORIES[i+1]) row.push(Markup.button.callback(CATEGORIES[i+1], `cat_${CATEGORIES[i+1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(buttons);
}
function deliveryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏠 Yetkazib berish", "delivery"), Markup.button.callback("🛍 Olib ketish", "pickup")]
  ]);
}

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// /start → telefonni so‘rash majburiy
bot.start(async ctx => {
  await ctx.reply("Assalomu alaykum! GG Market ga xush kelibsiz.\nTelefon raqamingizni yuboring:", Markup.keyboard([
    [Markup.button.contactRequest("Telefon raqamni yuborish 📞")]
  ]).resize());
});

// telefonni olamiz
bot.on("contact", async ctx => {
  const phone = ctx.message.contact?.phone_number;
  if (!phone) return ctx.reply("Telefonni yuboring iltimos!");
  userState.set(ctx.from.id, { phone });
  await ctx.reply(`Rahmat! Telefoningiz saqlandi: ${phone}`, mainMenuKeyboard());
});

// 📂 Bo‘limlar
bot.hears("📂 Bo'limlar", async ctx => {
  await ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());
});

// Inline kategoriyalar
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(`📦 ${cat}:`, productsKeyboardForCategory(cat));
  });
});

// Savatcha ko‘rsatish
bot.action("show_cart", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
  await ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "confirm_order"), Markup.button.callback("📄 Chek chiqarish", "generate_check")],
    [Markup.button.callback("🗑️ Savatchani tozalash", "clear_cart")]
  ]));
});

// Savatchani tozalash
bot.action("clear_cart", async ctx => { await ctx.answerCbQuery(); clearCart(ctx.from.id); return ctx.reply("Savatcha tozalandi ✅"); });

// Yetkazib berish yoki olib ketish
bot.action("confirm_order", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const state = userState.get(userId) || {};
  const phone = state.phone || "ko‘rsatilmagan";
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  userState.set(userId, { ...state, stage: "delivery_choice" });
  await ctx.reply("Buyurtmani qanday olasiz?", deliveryKeyboard());
});

bot.action("delivery", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const state = userState.get(userId) || {};
  userState.set(userId, { ...state, stage: "await_location" });
  await ctx.reply("Iltimos, yetkazib berish manzilingizni yuboring:", Markup.keyboard([
    [Markup.button.locationRequest("Lokatsiyani yuborish 📍")]
  ]).resize());
});
bot.action("pickup", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const state = userState.get(userId) || {};
  const phone = state.phone || "ko‘rsatilmagan";
  const { lines, total } = cartSummary(userId);
  const filePath = await createPdfTempFile(phone, lines, total);
  await ctx.reply(`Rahmat! Buyurtmangiz qabul qilindi.\nDo‘kon manzili: ${SHOP_ADDRESS}`);
  await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma (Olib ketish)\nTelefon: ${phone}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
  try { fs.unlinkSync(filePath); } catch(e){}
  clearCart(userId);
});

// Lokatsiyani olish
bot.on("location", async ctx => {
  const userId = ctx.from.id;
  const state = userState.get(userId) || {};
  if (state.stage !== "await_location") return;
  const { latitude, longitude } = ctx.message.location;
  const phone = state.phone || "ko‘rsatilmagan";
  const { lines, total } = cartSummary(userId);
  const filePath = await createPdfTempFile(phone, lines, total);
  await ctx.reply(`Rahmat! Lokatsiyangiz olindi. Buyurtmangiz qabul qilindi ✅`);
  await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma (Yetkazib berish)\nTelefon: ${phone}\nLokatsiya: https://www.google.com/maps?q=${latitude},${longitude}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
  try { fs.unlinkSync(filePath); } catch(e){}
  clearCart(userId);
  userState.delete(userId);
});

// AI / Suniy intelekt
bot.hears("💡 Suniy intelekt (AI)", async ctx => {
  await ctx.reply("Tabiiy tilda yozing: masalan 'Menga 2ta pepsi va 0.5 kg kartoshka qo'sh'.");
});
bot.on("text", async ctx => {
  const text = ctx.message.text || "";
  if (!openai) return;
  const userId = ctx.from.id;
  if (/📂|🛒|💡|\/start/.test(text)) return; // ignore control buttons
  await ctx.reply("AI buyurtmani tahlil qilmoqda... ⏳");
  try {
    const prompt = `
Siz buyurtma parserisiz. Foydalanuvchi matnini o'qib, quyidagi JSON ro'yxatini qaytaring: 
[{"name":"<mahsulot nomi>", "quantity": <son yoki decimal>, "unit": "kg"|"piece"|"sum"} , ...]
Faqat JSON qaytaring.

Input: ${JSON.stringify(text)}
    `;
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    });
    let jsonText = (res.choices?.[0]?.message?.content || "").trim().replace(/^[\s`]*json\r?\n?/i,"").replace(/```/g,"").trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed) || parsed.length===0) return ctx.reply("AI buyurtmani tushunmadi. Iltimos aniqroq yozing.");
    const added = [];
    for (const it of parsed) {
      const nameLower = (it.name || "").toLowerCase();
      const product = PRODUCTS.find(p => p.name.toLowerCase().includes(nameLower) || nameLower.includes(p.name.toLowerCase()));
      if (!product) { added.push(`❌ ${it.name} — mahsulot topilmadi`); continue; }
      let qty = Number(it.quantity || 1), price = product.price * qty;
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: it.unit, unitPrice: product.price, quantity: qty, price });
      added.push(`✅ ${product.name} — ${qty} ${it.unit==="piece"?"dona":it.unit==="kg"?"kg":"so'm"}`);
    }
    await ctx.reply(added.join("\n"));
  } catch(e) { console.error("AI error:", e); await ctx.reply("AI bilan bog‘lanishda xatolik yuz berdi."); }
});

// ---------- Bot launch ----------
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
