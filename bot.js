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

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN in environment");
if (!OPENAI_API_KEY) console.warn("Warning: OPENAI_API_KEY not set. AI features will not work.");

// ---------- Bot va OpenAI ----------
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
const carts = new Map(); // userId -> [{ productId, productName, unitType, unitPrice, quantity, price }]
const userState = new Map(); // userId -> { mode, productId }
const userPhones = new Map(); // userId -> phone

// ---------- Helper funksiyalar ----------
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
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
    if (ci.unitType === "sum") return `• ${ci.productName} — ${ci.price.toLocaleString()} so'm`;
    return `• ${ci.productName} — ${ci.quantity} × ${ci.unitPrice} = ${ci.price}`;
  });
  return { lines, total };
}
function chunkButtons(arr, cols = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}
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
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1], `cat_${CATEGORIES[i + 1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(buttons);
}

// ---------- PDF yaratish (telefon bilan) ----------
function createPdfTempFile(userId, lines, total, phone) {
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
      doc.fontSize(12).text(`Mijoz telefoni: ${phone}`);
      doc.moveDown();
      lines.forEach(line => doc.fontSize(12).text(line));
      doc.moveDown();
      doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });

      doc.end();
      stream.on("finish", () => resolve(filepath));
      stream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- Bot handlers ----------

// /start
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id;
    // So‘rash tugmasi bilan telefon
    await ctx.reply("Assalomu alaykum! GG Market ga xush kelibsiz.\nIltimos telefon raqamingizni yuboring:", 
      Markup.keyboard([
        Markup.button.contactRequest("📱 Telefonni yuborish")
      ]).resize()
    );
  } catch (e) { console.error(e); }
});

// Telefon yuborilganda saqlash
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  const userId = ctx.from.id;
  userPhones.set(userId, phone);
  await ctx.reply(`✅ Telefon raqamingiz saqlandi: ${phone}`, mainMenuKeyboard());
});

// Bo‘limlar
bot.hears("📂 Bo'limlar", async (ctx) => {
  await ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());
});

// inline categories
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

// Add product, KG / Sum / Piece handled
bot.action(/add_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const productId = ctx.match[1];
  const product = findProductById(productId);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  if (product.unit === "piece") {
    userState.set(ctx.from.id, { mode: "await_count", productId });
    return ctx.reply(`Nechta ${product.name} olasiz? (faqat butun son)`);
  }
  if (product.unit === "kg") {
    userState.set(ctx.from.id, { mode: "await_choice", productId });
    return ctx.reply(
      `${product.name} ni qanday olasiz?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("KG (kilogram)", `choice_kg_${productId}`), Markup.button.callback("SUMMA (so'm)", `choice_sum_${productId}`)],
        [Markup.button.callback("Bekor qilish", `choice_cancel_${productId}`)]
      ])
    );
  }
});

// KG / SUM / cancel
bot.action(/choice_kg_(\d+)/, async (ctx) => { await ctx.answerCbQuery(); userState.set(ctx.from.id, { mode: "await_kg", productId: ctx.match[1] }); ctx.reply("Necha kilogram olasiz? (masalan: 0.5)"); });
bot.action(/choice_sum_(\d+)/, async (ctx) => { await ctx.answerCbQuery(); userState.set(ctx.from.id, { mode: "await_sum", productId: ctx.match[1] }); ctx.reply("Necha so'mlik olasiz?"); });
bot.action(/choice_cancel_(\d+)/, async (ctx) => { await ctx.answerCbQuery(); userState.delete(ctx.from.id); ctx.reply("Bekor qilindi."); });

// Savatcha
bot.action("show_cart", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
  await ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "confirm_order"), Markup.button.callback("📄 Chek chiqarish", "generate_check")],
    [Markup.button.callback("🗑️ Savatchani tozalash", "clear_cart")]
  ]));
});

// Clear cart
bot.action("clear_cart", async (ctx) => { await ctx.answerCbQuery(); clearCart(ctx.from.id); ctx.reply("Savatcha tozalandi ✅"); });

// Generate check (PDF)
bot.action("generate_check", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  const phone = userPhones.get(userId) || "Telefon raqam ko‘rsatilmagan";
  try {
    const filePath = await createPdfTempFile(userId, lines, total, phone);
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    try { fs.unlinkSync(filePath); } catch (e) {}
  } catch (e) { console.error(e); ctx.reply("Chek yaratishda xatolik yuz berdi."); }
});

// Confirm order
bot.action("confirm_order", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  const phone = userPhones.get(userId) || "Telefon raqam ko‘rsatilmagan";
  try {
    const filePath = await createPdfTempFile(userId, lines, total, phone);
    const adminText = `📦 Yangi buyurtma\nTelefon: ${phone}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID, adminText);
    await bot.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });
    await ctx.reply("✅ Buyurtma qabul qilindi! Adminga yuborildi.");
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    try { fs.unlinkSync(filePath); } catch (e) {}
    clearCart(userId);
  } catch (e) { console.error("confirm_order error:", e); ctx.reply("Buyurtma yaratishda xatolik yuz berdi."); }
});

// AI mode
bot.action("ai_mode", async (ctx) => { await ctx.answerCbQuery(); ctx.reply("Tabiiy tilda yozing: masalan 'Menga 2ta pepsi va 0.5 kg kartoshka qo'sh'"); });

// User text input (count / kg / sum / AI)
bot.on("text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  const userId = ctx.from.id;

  if (userState.has(userId)) {
    const state = userState.get(userId);
    const product = findProductById(state.productId);
    if (!product) { userState.delete(userId); return ctx.reply("Mahsulot topilmadi."); }

    const normalized = text.replace(",", ".").replace(/[^0-9.]/g, "");
    const number = parseFloat(normalized);

    if (state.mode === "await_count") {
      const cnt = parseInt(text);
      if (isNaN(cnt) || cnt <= 0) return ctx.reply("Iltimos to'g'ri butun son kiriting.");
      const price = product.price * cnt;
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "piece", unitPrice: product.price, quantity: cnt, price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${cnt} dona savatchaga qo'shildi ✅`);
    }
    if (state.mode === "await_kg") {
      if (isNaN(number) || number <= 0) return ctx.reply("Iltimos to'g'ri kilogram kiriting.");
      const qty = number;
      const price = Math.round(product.price * qty);
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "kg", unitPrice: product.price, quantity: qty, price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${qty} kg savatchaga qo'shildi ✅`);
    }
    if (state.mode === "await_sum") {
      if (isNaN(number) || number <= 0) return ctx.reply("Iltimos to'g'ri summa kiriting.");
      const money = Math.round(number);
      const qty = money / product.price;
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "sum", unitPrice: product.price, quantity: qty, price: money });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${money.toLocaleString()} so'mlik savatchaga qo'shildi ✅ (≈${qty.toFixed(2)} kg)`);
    }

    userState.delete(userId);
    return ctx.reply("Kutilmagan holat — qayta urinib ko'ring.");
  }

  // AI / savatcha / bo‘limlar
  if (text === "🛒 Savatcha" || text.toLowerCase() === "/cart") {
    const { lines, total } = cartSummary(userId);
    if (!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
    return ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani tasdiqlash", "confirm_order"), Markup.button.callback("📄 Chek chiqarish", "generate_check")],
      [Markup.button.callback("🗑️ Savatchani tozalash", "clear_cart")]
    ]));
  }
  if (text === "📂 Bo'limlar") return ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());

  if ((text === "💡 Suniy intelekt (AI)" || text.toLowerCase().startsWith("/ai")) && openai) {
    const q = text.replace(/^\/ai\s*/i, "").trim();
    if (!q) return ctx.reply("Iltimos, /ai so'zidan keyin savolingizni yozing.");
    try {
      const r = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: q }], max_tokens: 500 });
      const answer = r.choices?.[0]?.message?.content || "AI javob topilmadi.";
      return ctx.reply(answer);
    } catch (e) { console.error("AI error:", e); return ctx.reply("AI bilan bog'lanishda xatolik yuz berdi."); }
  }

  return ctx.reply("Bo'limlardan tanlang yoki AI orqali buyurtma yuboring.");
});

// ---------- Ishga tushurish ----------
bot.launch().then(() => console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
