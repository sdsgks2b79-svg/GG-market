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

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY yo‘q, AI ishlamaydi");

const bot = new Telegraf(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Mahsulotlar
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

const carts = new Map();
const userState = new Map();

// Helper funksiyalar
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

// PDF yaratish
function createPdfTempFile(userPhone, lines, total) {
  return new Promise((resolve, reject) => {
    const filename = `check_${userPhone}_${Date.now()}.pdf`;
    const filepath = path.join("/tmp", filename);
    const doc = new PDFDocument({ margin: 30 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Telefon: ${userPhone || "ko‘rsatilmagan"}`);
    doc.moveDown();
    lines.forEach(line => doc.text(line));
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });
    doc.end();

    stream.on("finish", () => resolve(filepath));
    stream.on("error", reject);
  });
}

// AI buyurtma parser
async function aiParseOrderText(text) {
  if (!openai) return [];
  const prompt = `
Siz buyurtma parserisiz. Foydalanuvchi matnini o'qib, JSON ro'yxatini qaytaring: 
[{"name":"<mahsulot nomi>", "quantity": <son yoki decimal>, "unit": "kg"|"piece"|"sum"} , ...]

Shevada yozilgan, xato yoki qisqa matnni ham to‘g‘ri tushun. Faqat JSON qaytaring.
Input: ${JSON.stringify(text)}
  `;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    });
    const content = res.choices?.[0]?.message?.content || "";
    let jsonText = content.replace(/```/g, "").trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("AI parse error:", e);
    return [];
  }
}

// ---------- Start va stiker ----------
bot.start(async (ctx) => {
  try {
    await ctx.replyWithSticker("CAACAgIAAxkBAAEBP9VhZ4bJm4Hm7Bl6qHRo3vGdY8jR9AACFQADwDZPE4wV6wCXXLHgLwQ"); // istalgan sticker ID
    await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring:", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize().oneTime());
  } catch(e){ console.error(e); }
});

// Telefon qabul qilish
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  userState.set(ctx.from.id, { phone });
  await ctx.reply(`Rahmat! Sizning telefon raqamingiz: ${phone}`);
  await ctx.reply("📂 Bo'limlarni tanlang:", Markup.keyboard([["Bo'limlar"], ["🛒 Savatcha"], ["💡 Suniy intelekt (AI)"]]).resize());
});

// Yetkazib berish / olib ketish tugmalari
bot.action("delivery_or_pickup", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "delivery")],
    [Markup.button.callback("🏬 Olib ketish", "pickup")]
  ]));
});

bot.action("delivery", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("📍 Iltimos, lokatsiyangizni yuboring:", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yuborish")]
  ]).resize().oneTime());
});

bot.on("location", async (ctx) => {
  const loc = ctx.message.location;
  await bot.telegram.sendMessage(ADMIN_ID, `Mijoz lokatsiyasi: https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`);
  await ctx.reply("Rahmat! Buyurtmangiz qabul qilindi. Yetkazib berish manzilingiz qabul qilindi ✅");
});

// Olib ketish
bot.action("pickup", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Rahmat! Siz buyurtmani do‘kondan olishingiz mumkin. Do‘kon manzili: Toshkent, XYZ ko‘chasi 12");
});

// ---------- AI / Tabiiy tilda buyurtma ----------
bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (!openai) return;

  await ctx.reply("AI buyurtmani tahlil qilmoqda... ⏳");
  const parsed = await aiParseOrderText(text);
  if (!parsed || parsed.length === 0) return ctx.reply("AI tushunmadi, iltimos aniqroq yozing.");
  
  const userId = ctx.from.id;
  const phone = userState.get(userId)?.phone || "Telefon raqam ko‘rsatilmagan";
  let added = [];
  for(const it of parsed){
    const product = PRODUCTS.find(p => p.name.toLowerCase().includes(it.name.toLowerCase()));
    if(!product) { added.push(`❌ ${it.name} topilmadi`); continue; }
    let price = 0, qty = Number(it.quantity);
    if(it.unit==="piece") price = product.price * qty;
    if(it.unit==="kg") price = product.price * qty;
    if(it.unit==="sum") { price = qty; qty = qty/product.price; }
    addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: it.unit, unitPrice: product.price, quantity: qty, price });
    added.push(`✅ ${product.name} — ${it.quantity} ${it.unit==="piece"?"dona":it.unit==="kg"?"kg":"so'm"}`);
  }

  const { lines, total } = cartSummary(userId);
  const pdfPath = await createPdfTempFile(phone, lines, total);
  await ctx.replyWithDocument({ source: pdfPath, filename: path.basename(pdfPath) });
  await ctx.reply(added.join("\n"));
});

bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
