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
const ADMIN_ID = process.env.ADMIN_ID;
const SHOP_ADDRESS = process.env.SHOP_ADDRESS || "GG Market manzili: Toshkent, Amir Temur ko'chasi 12";

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// --- Mahsulotlar ---
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "🍓 Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "🥕 Sabzavotlar" },
  { id: 3, name: "Yogurt 200g", price: 8000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "🥤 Ichimliklar" },
  { id: 6, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "🥩 Kolbasalar" },
  { id: 7, name: "Shokolad", price: 20000, unit: "kg", category: "🍫 Shirinliklar" },
  { id: 8, name: "Non oddiy", price: 4000, unit: "piece", category: "🍞 Boshqa" }
];
const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

// --- Memory Stores ---
const carts = new Map(); // userId -> items
const userState = new Map(); // userId -> state
const userPhones = new Map(); // userId -> phone
const userDelivery = new Map(); // userId -> { type: "pickup"|"delivery", location }

// --- Helper Functions ---
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function clearCart(userId) { carts.delete(userId); }
function findProductById(id) { return PRODUCTS.find(p => p.id === Number(id)); }
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

// --- PDF ---
function createPdfTempFile(userId, lines, total, phone, deliveryType, location) {
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
      doc.fontSize(12).text(`Telefon: ${phone || "Ko'rsatilmagan"}`);
      doc.moveDown();
      lines.forEach(line => doc.fontSize(12).text(line));
      doc.moveDown();
      doc.fontSize(12).text(`Yetkazib berish turi: ${deliveryType === "delivery" ? "Yetkazib berish" : "Olib ketish"}`);
      if(location) doc.fontSize(12).text(`Lokatsiya: ${location.latitude}, ${location.longitude}`);
      doc.moveDown();
      doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`, { align: "right" });

      doc.end();
      stream.on("finish", () => resolve(filepath));
      stream.on("error", reject);
    } catch (e) { reject(e); }
  });
}

// --- AI Parser ---
async function parseOrderWithAI(userId, text) {
  if(!openai) return [];
  const prompt = `
Siz buyurtma parserisiz. Foydalanuvchi matnini o'qib, noto'g'ri yozilgan yoki shevada bo'lsa ham to'g'rilab, quyidagi JSON formatida chiqaring:
[{"name":"<mahsulot nomi>", "quantity": <son yoki decimal>, "unit": "kg"|"piece"|"sum"} , ...]
Faqat JSON chiqaring, izoh yo'q.
Input: ${text}
  `;
  try {
    const res = await openai.chat.completions.create({
      model:"gpt-3.5-turbo",
      messages:[{role:"user", content:prompt}],
      max_tokens:300
    });
    let content = res.choices?.[0]?.message?.content || "";
    content = content.replace(/```/g,"").trim();
    return JSON.parse(content);
  } catch(e) {
    console.error("AI parse error:", e);
    return [];
  }
}

// --- Keyboards ---
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)"]
  ]).resize();
}
function categoriesInlineKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [];
    row.push(Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`));
    if (CATEGORIES[i+1]) row.push(Markup.button.callback(CATEGORIES[i+1], `cat_${CATEGORIES[i+1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart")]);
  return Markup.inlineKeyboard(buttons);
}

// --- /start ---
bot.start(async (ctx)=>{
  await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring:", Markup.keyboard([
    [Markup.button.contactRequest("📲 Telefon raqam yuborish")]
  ]).resize());
});

// --- Contact ---
bot.on("contact", async(ctx)=>{
  const userId = ctx.from.id;
  const phone = ctx.message.contact?.phone_number;
  if(!phone) return ctx.reply("Telefon raqamni qabul qilib bo'lmadi!");
  userPhones.set(userId, phone);
  await ctx.reply("Telefon raqamingiz qabul qilindi ✅", mainMenuKeyboard());
});

// --- Categories ---
CATEGORIES.forEach(cat=>{
  bot.action(new RegExp(`^cat_${cat}$`), async(ctx)=>{
    const products = PRODUCTS.filter(p=>p.category===cat);
    const buttons = products.map(p=>Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`, `add_${p.id}`));
    buttons.push(Markup.button.callback("🛒 Savatcha","show_cart"));
    await ctx.reply(`📦 ${cat}:`, Markup.inlineKeyboard(chunkButtons(buttons,1)));
  });
});

// --- Add product ---
bot.action(/add_(\d+)/, async(ctx)=>{
  const pid = ctx.match[1];
  const product = findProductById(pid);
  const userId = ctx.from.id;
  if(!product) return ctx.reply("Mahsulot topilmadi!");
  if(product.unit==="piece"){
    userState.set(userId,{mode:"await_count", productId:pid});
    return ctx.reply(`Nechta ${product.name} olasiz?`);
  }
  if(product.unit==="kg"){
    userState.set(userId,{mode:"await_kg", productId:pid});
    return ctx.reply(`Necha kilogram ${product.name} olasiz?`);
  }
});

// --- Text handler ---
bot.on("text", async(ctx)=>{
  const userId = ctx.from.id;
  const text = ctx.message.text?.trim();
  if(!userPhones.has(userId)) return ctx.reply("Iltimos telefon raqamingizni yuboring!");

  // State handling
  if(userState.has(userId)){
    const state = userState.get(userId);
    const product = findProductById(state.productId);
    const number = parseFloat(text.replace(",",".").replace(/[^0-9.]/g,""));
    if(state.mode==="await_count"){
      if(isNaN(number)||number<=0) return ctx.reply("Iltimos butun son kiriting!");
      const price = product.price*Math.round(number);
      addOrReplaceInCart(userId,{productId:product.id, productName:product.name, unitType:"piece", unitPrice:product.price, quantity:Math.round(number), price});
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${Math.round(number)} dona savatchaga qo'shildi ✅`);
    }
    if(state.mode==="await_kg"){
      if(isNaN(number)||number<=0) return ctx.reply("Iltimos to'g'ri kg kiriting!");
      const price = Math.round(product.price*number);
      addOrReplaceInCart(userId,{productId:product.id, productName:product.name, unitType:"kg", unitPrice:product.price, quantity:number, price});
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${number} kg savatchaga qo'shildi ✅`);
    }
  }

  // AI mode
  if(text.startsWith("💡") || text.startsWith("/ai")){
    if(!openai) return ctx.reply("AI ishlamayapti — OPENAI_API_KEY yo'q");
    await ctx.reply("AI buyurtmani tahlil qilmoqda...");
    const parsed = await parseOrderWithAI(userId,text);
    if(!parsed.length) return ctx.reply("AI buyurtmani tushunmadi.");
    let added = [];
    for(const it of parsed){
      const prod = PRODUCTS.find(p=>p.name.toLowerCase().includes(it.name.toLowerCase())||it.name.toLowerCase().includes(p.name.toLowerCase()));
      if(!prod){ added.push(`❌ ${it.name} — topilmadi`); continue; }
      let price=0, qty=it.quantity;
      if(it.unit==="piece"){ price=prod.price*qty; addOrReplaceInCart(userId,{productId:prod.id,productName:prod.name,unitType:"piece",unitPrice:prod.price,quantity:qty,price}); }
      if(it.unit==="kg"){ price=Math.round(prod.price*qty); addOrReplaceInCart(userId,{productId:prod.id,productName:prod.name,unitType:"kg",unitPrice:prod.price,quantity:qty,price}); }
      if(it.unit==="sum"){ price=qty; qty=qty/prod.price; addOrReplaceInCart(userId,{productId:prod.id,productName:prod.name,unitType:"sum",unitPrice:prod.price,quantity:qty,price}); }
      added.push(`✅ ${prod.name} — ${it.quantity} ${it.unit}`);
    }
    return ctx.reply(added.join("\n"));
  }

  // Show cart
  if(text==="🛒 Savatcha"){
    const {lines,total} = cartSummary(userId);
    if(!lines.length) return ctx.reply("Savatcha bo'sh!");
    return ctx.reply(`🛍 Sizning savatchangiz:\n${lines.join("\n")}\nJami: ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani tasdiqlash","confirm_order")],
      [Markup.button.callback("🗑️ Savatchani tozalash","clear_cart")]
    ]));
  }

  if(text==="📂 Bo'limlar") return ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());
});

// --- Confirm order ---
bot.action("confirm_order",async(ctx)=>{
  const userId = ctx.from.id;
  const phone = userPhones.get(userId);
  const {lines,total} = cartSummary(userId);
  if(!lines.length) return ctx.reply("Savatcha bo'sh!");

  userState.set(userId,{mode:"await_delivery"});
  return ctx.reply("Buyurtmani qanday olasiz?",Markup.inlineKeyboard([
    [Markup.button.callback("Olib ketish","pickup"),Markup.button.callback("Yetkazib berish","delivery")]
  ]));
});

// --- Delivery choice ---
bot.action(/pickup|delivery/,async(ctx)=>{
  const userId = ctx.from.id;
  const type = ctx.match[0];
  userDelivery.set(userId,{type});
  if(type==="delivery"){
    userState.set(userId,{mode:"await_location"});
    await ctx.reply("Lokatsiyangizni yuboring:",Markup.keyboard([
      [Markup.button.locationRequest("📍 Lokatsiya yuborish")]
    ]).resize());
  } else {
    await ctx.reply(`Rahmat! Do'konga olib kelish uchun manzil: ${SHOP_ADDRESS}`);
    await finalizeOrder(ctx,userId);
  }
});

// --- Location ---
bot.on("location",async(ctx)=>{
  const userId = ctx.from.id;
  const loc = ctx.message.location;
  const delivery = userDelivery.get(userId);
  if(!delivery||delivery.type!=="delivery") return;
  delivery.location=loc;
  userDelivery.set(userId,delivery);
  await ctx.reply("Lokatsiyangiz qabul qilindi ✅");
  await finalizeOrder(ctx,userId);
});

// --- Finalize Order ---
async function finalizeOrder(ctx,userId){
  const phone = userPhones.get(userId);
  const delivery = userDelivery.get(userId);
  const {lines,total} = cartSummary(userId);
  const filePath = await createPdfTempFile(userId,lines,total,phone,delivery.type,delivery.location);
  const text = `📦 Yangi buyurtma\nTelefon: ${phone}\nTuri: ${delivery.type==="delivery"?"Yetkazib berish":"Olib ketish"}\n\n${lines.join("\n")}\nJami: ${total.toLocaleString()} so'm`;

  await bot.telegram.sendMessage(ADMIN_ID,text);
  await bot.telegram.sendDocument(ADMIN_ID,{source:filePath,filename:path.basename(filePath)});
  await ctx.reply("✅ Buyurtma qabul qilindi! Adminga yuborildi.");
  await ctx.replyWithDocument({source:filePath,filename:path.basename(filePath)});

  try{fs.unlinkSync(filePath);}catch(e){}
  clearCart(userId);
  userDelivery.delete(userId);
}

// --- Clear cart ---
bot.action("clear_cart",async(ctx)=>{
  const userId = ctx.from.id;
  clearCart(userId);
  return ctx.reply("Savatcha tozalandi ✅");
});

// --- Launch ---
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
