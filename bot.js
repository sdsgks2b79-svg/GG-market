// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
import session from "telegraf/session.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "200012560"; // sizning admin raqamingiz

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ---------- Mahsulotlar ----------
const PRODUCTS = [
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "🥔 Sabzavotlar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "🥕 Sabzavotlar" },
  { id: 3, name: "Yogurt 200g", price: 8000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "🥛 Sut mahsulotlari" },
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "🥤 Ichimliklar" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "🥤 Ichimliklar" },
  { id: 7, name: "Kolbasa", price: 50000, unit: "kg", category: "🥩 Kolbasa va go'sht" },
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "🍫 Shirinliklar" },
  { id: 9, name: "Non oddiy", price: 4000, unit: "piece", category: "🍞 Non mahsulotlari" },
  { id: 10, name: "Sovun", price: 12000, unit: "piece", category: "🧴 Yuvish vositalari" }
];

// ---------- Kategoriyalar ----------
const CATEGORIES = [...new Set(PRODUCTS.map(p => p.category))];

// ---------- Helpers ----------
function chunkButtons(arr, cols = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}

function productsKeyboard(category) {
  const prods = PRODUCTS.filter(p => p.category === category);
  const buttons = prods.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`, `add_${p.id}`));
  buttons.push(Markup.button.callback("🛒 Savatim", "show_cart"));
  return Markup.inlineKeyboard(chunkButtons(buttons,1));
}

function cartSummary(ctx) {
  const cart = ctx.session.cart || [];
  let total = 0;
  const lines = cart.map(item => {
    total += item.price;
    if(item.unitType==="piece") return `• ${item.name} — ${item.quantity} dona × ${item.unitPrice.toLocaleString()} = ${item.price.toLocaleString()} so'm`;
    if(item.unitType==="kg") return `• ${item.name} — ${item.quantity.toFixed(2)} kg × ${item.unitPrice.toLocaleString()} = ${item.price.toLocaleString()} so'm`;
  });
  return { lines, total };
}

function createPDF(ctx) {
  return new Promise((resolve,reject)=>{
    const cart = ctx.session.cart || [];
    if(!cart.length) return reject("Savat bo'sh!");
    const doc = new PDFDocument({margin:30});
    const tmpFile = path.join("/tmp", `check_${ctx.from.id}_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(tmpFile);
    doc.pipe(stream);
    const date = new Date().toLocaleString();
    doc.fontSize(18).text("GG Market — Buyurtma Cheki",{align:"center"});
    doc.moveDown();
    doc.fontSize(12).text(`Sana va vaqt: ${date}`);
    doc.moveDown();
    cart.forEach(item=>{
      if(item.unitType==="piece") doc.text(`• ${item.name} — ${item.quantity} dona × ${item.unitPrice.toLocaleString()} = ${item.price.toLocaleString()} so'm`);
      else doc.text(`• ${item.name} — ${item.quantity.toFixed(2)} kg × ${item.unitPrice.toLocaleString()} = ${item.price.toLocaleString()} so'm`);
    });
    const total = cart.reduce((sum,it)=>sum+it.price,0);
    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`,{align:"right"});
    doc.moveDown();
    doc.text("Haridingiz uchun rahmat! ❤️",{align:"center"});
    doc.end();
    stream.on("finish",()=>resolve(tmpFile));
    stream.on("error", reject);
  });
}

// ---------- Menyu ----------
function mainMenu() {
  return Markup.keyboard([
    ["🛍 Mahsulotlar","🛒 Savatim","📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili","✨ Maxsus takliflar","💰 Qarzlarim"],
    ["/start"]
  ]).resize();
}

// ---------- Bot Handlers ----------

// /start
bot.start(async ctx=>{
  ctx.session.cart = [];
  ctx.session.userState = null;
  ctx.session.address = null;
  ctx.session.delivery = null;
  ctx.session.debt = 0;
  await ctx.reply("Assalomu alaykum! Iltimos telefon raqamingizni yuboring.",Markup.keyboard([
    [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
  ]).resize());
});

// Telefon qabul qilinadi
bot.on("contact", async ctx=>{
  const phone = ctx.message.contact.phone_number;
  ctx.session.phone = phone;
  await ctx.reply(`Rahmat! Telefoningiz saqlandi: ${phone}`, mainMenu());
});

// Menyu tugmalari
bot.hears("🛍 Mahsulotlar", async ctx=>{
  const buttons = CATEGORIES.map(cat=>Markup.button.callback(cat, `cat_${cat}`));
  await ctx.reply("Bo'limni tanlang:",Markup.inlineKeyboard(chunkButtons(buttons,3)));
});

bot.action(/cat_(.+)/, async ctx=>{
  const category = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.reply(`📦 ${category}`, productsKeyboard(category));
});

// Mahsulotni savatga qo'shish
bot.action(/add_(\d+)/, async ctx=>{
  const pid = Number(ctx.match[1]);
  const prod = PRODUCTS.find(p=>p.id===pid);
  if(!prod) return;
  ctx.session.userState = { mode:prod.unit==="kg"?"await_kg":"await_piece", product:prod };
  await ctx.reply(prod.unit==="kg"?`Necha kilogram olasiz yoki qancha so'mlik? (masalan: 0.5 yoki 3500)`:`Nechta dona olasiz?`);
  await ctx.answerCbQuery();
});

// Miqdor kiritish
bot.on("text", async ctx=>{
  if(!ctx.session.userState) return;
  const text = ctx.message.text.replace(",",".");

  let prod = ctx.session.userState.product;
  if(ctx.session.userState.mode==="await_piece"){
    const qty = parseInt(text);
    if(isNaN(qty)||qty<=0) return ctx.reply("Iltimos to'g'ri butun son kiriting");
    const price = prod.price*qty;
    ctx.session.cart.push({id:prod.id,name:prod.name,unitType:"piece",unitPrice:prod.price,quantity:qty,price});
    ctx.session.userState = null;
    return ctx.reply(`${prod.name} — ${qty} dona savatchaga qo'shildi ✅`);
  }
  if(ctx.session.userState.mode==="await_kg"){
    let qty = parseFloat(text);
    let price = 0;
    if(text.includes("so'm")){
      const sum = parseInt(text.replace(/[^0-9]/g,""));
      if(isNaN(sum)||sum<=0) return ctx.reply("Iltimos to'g'ri summa kiriting");
      qty = sum/prod.price;
      price = sum;
    } else {
      if(isNaN(qty)||qty<=0) return ctx.reply("Iltimos to'g'ri kilogram kiriting");
      price = Math.round(prod.price*qty);
    }
    ctx.session.cart.push({id:prod.id,name:prod.name,unitType:"kg",unitPrice:prod.price,quantity:qty,price});
    ctx.session.userState = null;
    return ctx.reply(`${prod.name} — ${price.toLocaleString()} so'mlik savatchaga qo'shildi ✅`);
  }
});

// Savatni ko'rsatish
bot.hears(/🛒 Savatim/, async ctx=>{
  const { lines, total } = cartSummary(ctx);
  if(!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
  await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`);
});

// Do'kon manzili
bot.hears("📍 Do'kon manzili", async ctx=>{
  await ctx.reply("Do'kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
});

// Sotuvchi bilan bog'lanish
bot.hears("📞 Sotuvchi bilan bog'lanish", async ctx=>{
  await ctx.reply("Sotuvchiga bog'lanish: +998200012560");
});

// Maxsus takliflar
bot.hears("✨ Maxsus takliflar", async ctx=>{
  await ctx.reply("Hozircha hech narsa yo'q 😊");
});

// Qarzlarim
bot.hears("💰 Qarzlarim", async ctx=>{
  const debt = ctx.session.debt||0;
  await ctx.reply(debt?`Sizning qarzingiz: ${debt.toLocaleString()} so'm`:"Hozircha hech narsa!");
});

// Yetkazib berish va olib ketish
bot.hears("💳 Buyurtma tugallash", async ctx=>{
  if(!(ctx.session.cart||[]).length) return ctx.reply("Savat bo'sh!");
  await ctx.reply("Yetkazib berish yoki olib ketish?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish","delivery"), Markup.button.callback("🏬 Olib ketish","pickup")]
  ]));
});

// Yetkazib berish
bot.action("delivery", async ctx=>{
  await ctx.answerCbQuery();
  ctx.session.delivery = "delivery";
  await ctx.reply("Iltimos lokatsiyangizni yuboring.",Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yuborish")]
  ]).resize());
});

// Olib ketish
bot.action("pickup", async ctx=>{
  await ctx.answerCbQuery();
  ctx.session.delivery = "pickup";
  await ctx.reply("Siz olib ketishni tanladingiz. Do’kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
});

// Lokatsiya qabul qilish
bot.on("location", async ctx=>{
  if(ctx.session.delivery==="delivery"){
    ctx.session.loc = ctx.message.location;
    await ctx.reply("Lokatsiya qabul qilindi. Adminga yuborildi ✅");
    await bot.telegram.sendMessage(ADMIN_ID,`Yangi buyurtma: Lokatsiya: Lat:${ctx.message.location.latitude}, Lon:${ctx.message.location.longitude}`);
  }
});

// PDF chek yaratish va adminga yuborish
bot.hears("💳 Buyurtma tugallash", async ctx=>{
  if(!(ctx.session.cart||[]).length) return ctx.reply("Savat bo'sh!");
  const filePath = await createPDF(ctx);
  await ctx.replyWithDocument({source:filePath, filename:path.basename(filePath)});
  await bot.telegram.sendDocument(ADMIN_ID,{source:filePath, filename:path.basename(filePath)});
  fs.unlinkSync(filePath);
});

// ---------- Bot ishga tushirish ----------
bot.launch()
  .then(()=>console.log("Bot ishga tushdi 🚀"))
  .catch(e=>console.error(e));

process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
