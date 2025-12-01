// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "8235655604";
const SHOP_LOCATION = "https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic";

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Mahsulotlar
const PRODUCTS = [
  // 🍓 Mevalar
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "🍓 Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "🍓 Mevalar" },
  // 🥛 Sut mahsulotlari
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  // 🥤 Ichimliklar
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "🥤 Ichimliklar" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "🥤 Ichimliklar" },
  // 🧴 Tozalash vositalari
  { id: 7, name: "Detergent", price: 50000, unit: "piece", category: "🧴 Tozalash vositalari" },
  // 🥩 Kolbasalar
  { id: 8, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "🥩 Kolbasalar" },
  // 🍫 Shirinliklar
  { id: 9, name: "Shokolad", price: 20000, unit: "kg", category: "🍫 Shirinliklar" },
  // 🍞 Boshqa
  { id: 10, name: "Non oddiy", price: 4000, unit: "piece", category: "🍞 Boshqa" },
];

const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

const carts = new Map();
const userState = new Map();
const userPhone = new Map();
const userDelivery = new Map(); // "pickup" | "delivery"
const userLocation = new Map();

// Helper funksiyalar
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function clearCart(userId) { carts.delete(userId); userState.delete(userId); userDelivery.delete(userId); userLocation.delete(userId);}
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
      doc.fontSize(12).text(`Telefon: ${phone || "ko'rsatilmagan"}`);
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

// Main menus
function mainMenuKeyboard() {
  const rows = [
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)", "/start"]
  ];
  return Markup.keyboard(rows).resize();
}
function categoriesInlineKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`)];
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i+1], `cat_${CATEGORIES[i+1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(buttons);
}

// --- Start
bot.start(async (ctx) => {
  try {
    await ctx.reply("Assalomu alaykum! GG Market ga xush kelibsiz.\nTelefon raqamingizni yuboring:", Markup.keyboard([
      [Markup.button.contactRequest("📱 Telefonni yuborish")]
    ]).resize());
  } catch (e) { console.error(e); }
});

// --- Kontakt (telefon)
bot.on("contact", async (ctx) => {
  const userId = ctx.from.id;
  if (!ctx.message.contact || !ctx.message.contact.phone_number) return ctx.reply("Telefon raqamingizni yuboring.");
  userPhone.set(userId, ctx.message.contact.phone_number);
  await ctx.reply("Rahmat! Telefon qabul qilindi ✅", mainMenuKeyboard());
});

// --- Bo‘limlar
bot.hears("📂 Bo'limlar", async (ctx) => { await ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard()); });

// --- Inline category actions
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`📦 ${cat}:`, productsKeyboardForCategory(cat));
  });
});

// --- Add product
bot.action(/add_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const pid = ctx.match[1];
  const product = findProductById(pid);
  if (!product) return ctx.reply("Mahsulot topilmadi");
  const userId = ctx.from.id;
  if (product.unit === "piece") {
    userState.set(userId, { mode: "await_count", productId: pid });
    return ctx.reply(`Nechta ${product.name} olasiz?`);
  }
  if (product.unit === "kg") {
    userState.set(userId, { mode: "await_kg", productId: pid });
    return ctx.reply(`Necha kilogram olasiz?`);
  }
});

// --- Text handler
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;
  if (!userPhone.has(userId)) return ctx.reply("Iltimos, telefoningizni yuboring!"); 
  // Savatcha va AI tugmalar
  if (text === "🛒 Savatcha") {
    const {lines, total} = cartSummary(userId);
    if (!lines.length) return ctx.reply("Savatcha bo‘sh!");
    return ctx.reply(`🛍 Sizning savatchangiz:\n${lines.join("\n")}\nJami: ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani yakunlash", "choose_delivery")],
      [Markup.button.callback("🗑 Savatchani tozalash", "clear_cart")]
    ]));
  }
  if (text === "💡 Suniy intelekt (AI)" || text.toLowerCase().startsWith("/ai")) {
    if (!openai) return ctx.reply("AI ishlamayapti — OPENAI_API_KEY yoqilmagan.");
    try {
      const q = text.startsWith("/ai") ? text.replace("/ai","").trim() : text;
      await ctx.reply("AI tahlil qilmoqda ⏳");
      const r = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages:[{role:"user",content:q}],
        max_tokens: 500
      });
      const answer = r.choices?.[0]?.message?.content || "AI javob topilmadi.";
      return ctx.reply(answer);
    } catch(e){console.error(e); return ctx.reply("AI bilan bog‘lanishda xatolik yuz berdi.");}
  }
  // --- Qo‘shimcha: buyurtma qo‘shish kg/piece
  if (userState.has(userId)) {
    const state = userState.get(userId);
    const product = findProductById(state.productId);
    const n = parseFloat(text.replace(",",".").replace(/[^0-9.]/g,""));
    if(state.mode==="await_count"){ const cnt=parseInt(text); if(isNaN(cnt)||cnt<=0) return ctx.reply("To‘g‘ri son kiriting"); addOrReplaceInCart(userId,{productId:product.id,productName:product.name,unitType:"piece",unitPrice:product.price,quantity:cnt,price:cnt*product.price}); userState.delete(userId); return ctx.reply(`${product.name} — ${cnt} dona qo‘shildi ✅`);}
    if(state.mode==="await_kg"){ if(isNaN(n)||n<=0) return ctx.reply("To‘g‘ri kg kiriting"); addOrReplaceInCart(userId,{productId:product.id,productName:product.name,unitType:"kg",unitPrice:product.price,quantity:n,price:Math.round(n*product.price)}); userState.delete(userId); return ctx.reply(`${product.name} — ${n} kg qo‘shildi ✅`);}
  }
});

// --- Delivery / pickup
bot.action("choose_delivery", async (ctx)=>{
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  await ctx.reply("Buyurtmani qanday olasiz?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "delivery"), Markup.button.callback("🏬 Olib ketish", "pickup")]
  ]));
});
bot.action("delivery", async (ctx)=>{
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userDelivery.set(userId,"delivery");
  await ctx.reply("Iltimos lokatsiyangizni yuboring", Markup.keyboard([[Markup.button.locationRequest("📍 Lokatsiyani yuborish")]]).resize());
});
bot.action("pickup", async (ctx)=>{
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  userDelivery.set(userId,"pickup");
  await ctx.reply(`Rahmat! Do‘kon manzili: ${SHOP_LOCATION}`, mainMenuKeyboard());
});

// --- Location handler
bot.on("location", async (ctx)=>{
  const userId = ctx.from.id;
  if(userDelivery.get(userId)!=="delivery") return;
  const loc = ctx.message.location;
  userLocation.set(userId, loc);
  await ctx.reply(`Lokatsiya qabul qilindi ✅\nAdminga yuborildi.`);
  const {lines,total} = cartSummary(userId);
  const phone = userPhone.get(userId);
  const filePath = await createPdfTempFile(userId,lines,total,phone);
  const adminText = `📦 Yangi buyurtma\nTelefon: ${phone || "ko‘rsatilmagan"}\nJami: ${total.toLocaleString()} so'm\n`;
  await bot.telegram.sendMessage(ADMIN_ID, adminText);
  await bot.telegram.sendDocument(ADMIN_ID,{source:filePath,filename:path.basename(filePath)});
  clearCart(userId);
});

// --- Clear cart
bot.action("clear_cart", async (ctx)=>{ await ctx.answerCbQuery(); clearCart(ctx.from.id); return ctx.reply("Savatcha tozalandi ✅"); });

// Launch
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀")).catch(console.error);
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
