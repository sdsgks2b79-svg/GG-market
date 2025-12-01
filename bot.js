// bot.js
import { Telegraf, session, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID)
  throw new Error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// GLOBALS
let PRODUCTS = [];
let CATEGORIES = [];

// UTILS
function chunkButtons(arr, cols = 3) {
  const out = [];
  for (let i = 0; i < arr.length; i += cols) out.push(arr.slice(i, i + cols));
  return out;
}

function formatCurrency(n) {
  return Number(n).toLocaleString();
}

function ensureSession(ctx) {
  ctx.session = ctx.session || {};
  if (!ctx.session.cart) ctx.session.cart = [];
  return ctx.session;
}

// Load products from Supabase
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) {
    console.error(error);
    PRODUCTS = [];
    CATEGORIES = [];
    return;
  }
  PRODUCTS = data.map(p => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit_name, // piece yoki kg
    category: p.category,
    image_url: p.image_url || null
  }));
  const set = new Set();
  PRODUCTS.forEach(p => set.add(p.category));
  CATEGORIES = Array.from(set);
  console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
}
await loadProducts();

// MAIN MENU
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

// CATEGORY BUTTONS
function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => Markup.button.callback(`${c}`, `cat_${i}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 3));
}

function productsKeyboard(idx) {
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);
  const buttons = prods.map(p => Markup.button.callback(`${p.name} — ${formatCurrency(p.price)} ${p.unit==="kg"?"so'm/kg":"so'm"}`, `product_${p.id}`));
  buttons.push(Markup.button.callback("🔙 Ortga", `back_main`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}

// PDF CHECK
function createOrderPdf({ userId, phone, lines, total, deliveryType, address }) {
  return new Promise((resolve, reject) => {
    try {
      const tmp = process.env.TMPDIR || "/tmp";
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmp, filename);

      const doc = new PDFDocument({ margin: 36 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil / Lokatsiya: ${address}`);
      doc.moveDown();
      doc.fontSize(12).text("Buyurtma tafsiloti:");
      lines.forEach(line => doc.text(line));
      doc.moveDown(0.6);
      doc.fontSize(13).text(`Jami: ${formatCurrency(total)} so'm`, { align: "right" });
      doc.moveDown(1);
      doc.fontSize(11).text("Haridingiz uchun rahmat!", { align: "center" });
      doc.end();

      stream.on("finish", () => resolve(filepath));
      stream.on("error", err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// CART SUMMARY
function cartSummary(session) {
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if(ci.unit==="piece") return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if(ci.unit==="kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if(ci.unit==="sum") return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
  });
  return { lines, total };
}

// ----------------- HANDLERS -----------------

bot.start(async ctx => {
  ensureSession(ctx);
  if(!ctx.session.phone){
    await ctx.reply("Assalomu alaykum! Telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

bot.on("contact", async ctx=>{
  ensureSession(ctx);
  const phone = ctx.message.contact?.phone_number;
  if(phone){
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring.");
  }
});

// Mahsulotlar
bot.hears("🍏 Mahsulotlar", async ctx=>{
  if(!CATEGORIES.length) return ctx.reply("Hozirda mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

// Category
bot.action(/^cat_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  await ctx.reply(`📦 ${CATEGORIES[idx]}`, productsKeyboard(idx));
});

// Back
bot.action("back_main", async ctx=>{
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// Product
bot.action(/^product_(\d+)$/, async ctx=>{
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id===pid);
  if(!product) return ctx.reply("Mahsulot topilmadi.");
  ensureSession(ctx);

  if(product.image_url){
    await ctx.replyWithPhoto(product.image_url,{
      caption:`${product.name}\nNarx: ${formatCurrency(product.price)} ${product.unit==="kg"?"so'm/kg":"so'm"}`
    });
  } else {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)} ${product.unit==="kg"?"so'm/kg":"so'm"}`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  const question = product.unit==="piece" ? "Nechta olasiz?" : "Necha kilogram yoki qancha so'mlik olasiz?";
  await ctx.reply(question);
});

// -------- TEXT HANDLER --------
bot.on("text", async ctx=>{
  ensureSession(ctx);
  const txt = ctx.message.text?.trim();

  if(ctx.session.pending){
    const pending = ctx.session.pending;
    const product = PRODUCTS.find(p=>p.id===pending.productId);
    if(!product) return ctx.reply("Mahsulot topilmadi.");

    const cleaned = txt.replace(",",".").replace(/[^0-9.]/g,"");
    const num = parseFloat(cleaned);
    if(isNaN(num) || num<=0) return ctx.reply("Iltimos to'g'ri son kiriting.");

    let quantity=0, price=0, unitType="";

    if(product.unit==="piece"){
      quantity = Math.round(num);
      price = quantity*product.price;
      unitType = "piece";
    } else if(product.unit==="kg"){
      const lower = txt.toLowerCase();
      if(lower.includes("so'm") || lower.includes("sum") || lower.includes("so")){
        price = Math.round(num);
        quantity = +(price / product.price);
        unitType = "sum";
      } else {
        quantity = num;
        price = Math.round(quantity*product.price);
        unitType = "kg";
      }
    }

    ctx.session.cart.push({
      productId: product.id,
      name: product.name,
      unit: unitType,
      unitPrice: product.price,
      quantity,
      price,
      image_url: product.image_url || null
    });

    ctx.session.pending=null;
    const { lines,total } = cartSummary(ctx.session);

    await ctx.reply(`${product.name} savatchaga qo'shildi ✅\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🛒 Savatni ko'rish","show_cart"), Markup.button.callback("✅ Buyurtmani tasdiqlash","start_checkout")]
      ])
    );

    return ctx.reply("Yana boshqa mahsulotlarni tanlang 👇", categoriesKeyboard());
  }

  // MAIN MENU TEXTS
  switch(txt){
    case "🛒 Savatim":
      const { lines,total } = cartSummary(ctx.session);
      if(!lines.length) return ctx.reply("Savatcha bo'sh!");
      await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Buyurtmani tasdiqlash","start_checkout"), Markup.button.callback("🗑️ Savatni tozalash","clear_cart")]
        ])
      );
      break;
    case "📞 Sotuvchi bilan bog'lanish":
      await ctx.reply("Sotuvchi: +998200012560");
      break;
    case "📍 Do'kon manzili":
      await ctx.reply("Do'kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
      break;
    case "🎁 Maxsus takliflar":
      await ctx.reply("Hozircha hech narsa yo'q 😊");
      break;
    case "💳 Qarzlarim":
      await ctx.reply("Hozircha qarzingiz yo'q ✅");
      break;
    default:
      return ctx.reply("Menyudan tanlang yoki mahsulot miqdorini kiriting.");
  }
});

// ---------- SAVAT VA CHECKOUT HANDLERS ----------

bot.action("show_cart", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines,total } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo'sh!");
  await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani tasdiqlash","start_checkout"), Markup.button.callback("🗑️ Savatni tozalash","clear_cart")]
    ])
  );
});

bot.action("clear_cart", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.cart=[];
  await ctx.reply("Savatcha tozalandi ✅");
});

// Delivery / pickup
bot.action("start_checkout", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines,total } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo'sh!");
  await ctx.reply("Buyurtmani qanday olmoqchisiz?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish","choose_delivery_delivery"), Markup.button.callback("🏬 Olib ketish","choose_delivery_pickup")]
  ]));
});

// Delivery
bot.action("choose_delivery_delivery", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout={delivery:"delivery"};
  await ctx.reply("Iltimos lokatsiyangizni yuboring 📍",
    Markup.keyboard([[Markup.button.locationRequest("📍 Lokatsiyani yo'natish")]]).resize()
  );
});

// Pickup
bot.action("choose_delivery_pickup", async ctx=>{
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout={delivery:"pickup", address:"https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic"};
  await ctx.reply(`Do'kon manzili: ${ctx.session.checkout.address}`);
  await askPayment(ctx);
});

// Location
bot.on("location", async ctx=>{
  ensureSession(ctx);
  if(!ctx.session.checkout || ctx.session.checkout.delivery!=="delivery") return ctx.reply("Lokatsiyangiz uchun rahmat.");
  const loc=ctx.message.location;
  ctx.session.checkout.address=`Lat:${loc.latitude},Lon:${loc.longitude}`;
  const phone=ctx.session.phone||"Noma'lum";
  const mapLink=`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
  await bot.telegram.sendMessage(ADMIN_ID, `📍 Yangi yetkazib berish buyurtmasi\nTelefon: ${phone}\nLokatsiya: ${mapLink}`);
  await ctx.reply("Lokatsiyangiz qabul qilindi ✅");
  await askPayment(ctx);
});

// Payment
async function askPayment(ctx){
  await ctx.reply("To'lov usulini tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("💵 Naqd","pay_cash"), Markup.button.callback("💳 Karta","pay_card")]
  ]));
}

bot.action("pay_cash", async ctx=>{
  await ctx.answerCbQuery();
  await finalizeOrder(ctx,"Naqd");
});

bot.action("pay_card", async ctx=>{
  await ctx.answerCbQuery();
  await ctx.reply("To‘lov uchun karta raqam: 9860 1201 3619 1216\nTo‘lovni amalga oshirib, skrenshotini menga yuboring ✅");
});

// Finalize order
async function finalizeOrder(ctx,paymentMethod){
  ensureSession(ctx);
  const { lines,total } = cartSummary(ctx.session);
  if(!lines.length) return ctx.reply("Savatcha bo'sh!");
  const phone=ctx.session.phone||"Noma'lum";
  const deliveryType=ctx.session.checkout?.delivery==="pickup"?"Olib ketish":"Yetkazib berish";
  const address=ctx.session.checkout?.address||"";
  try{
    const pdfPath=await createOrderPdf({userId:ctx.from.id,phone,lines,total,deliveryType,address});
    await ctx.replyWithDocument({source:pdfPath, filename:path.basename(pdfPath)});
    await ctx.reply("✅ Buyurtmangiz qabul qilindi. Tez orada yetkazib beramiz. /start", mainMenuKeyboard());

    let mapPart="";
    if(address.startsWith("Lat:")){
      mapPart=`Lokatsiya: https://www.google.com/maps?q=${address.split("Lat:")[1].split(",Lon:")[0]},${address.split("Lon:")[1]}`;
    } else mapPart=address;
    const adminText=`📦 Yangi buyurtma\nTelefon: ${phone}\nTo'lov: ${paymentMethod}\n${mapPart?mapPart+"\n":""}\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID,adminText);
    await bot.telegram.sendDocument(ADMIN_ID,{source:pdfPath, filename:path.basename(pdfPath)});
    try{fs.unlinkSync(pdfPath);}catch(e){}
    ctx.session.cart=[];
    ctx.session.checkout=null;
  }catch(err){console.error(err);ctx.reply("Buyurtma yaratilishda xatolik yuz berdi.");}
}

// Launch
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀")).catch(e=>console.error("Launch error:",e));

// Graceful stop
process.once("SIGINT",()=>bot.stop("SIGINT"));
