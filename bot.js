// bot.js
import { Telegraf, session, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

// --- ENV ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID;
const CARD_NUMBER = process.env.CARD_NUMBER || "9860120136191216";
const STORE_LOCATION = process.env.STORE_LOCATION || "https://maps.app.goo.gl/8VjBiyPwPGP7nHZZ6?g_st=ic";
const CONTACT_PHONE = process.env.CONTACT_PHONE || "200012560";

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID) {
  console.error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");
  process.exit(1);
}

// --- Clients ---
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Globals ---
let PRODUCTS = [];   // {id,name,price,unit,category,emoji,image_url}
let CATEGORIES = []; // unique categories
let SPECIAL_OFFERS = []; // can be filled later

// --- Helpers ---
const formatCurrency = n => Number(n).toLocaleString();
const chunk = (arr, n = 3) => { const out = []; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; };
function ensureSession(ctx){ ctx.session = ctx.session || {}; if(!ctx.session.cart) ctx.session.cart = []; return ctx.session; }

// --- Load products from Supabase ---
async function loadProducts() {
  try {
    const { data, error } = await supabase.from("products").select("*");
    if (error) {
      console.error("Supabase load products error:", error);
      PRODUCTS = [];
      CATEGORIES = [];
      return;
    }
    PRODUCTS = data.map(p => ({
      id: Number(p.id),
      name: p.name,
      price: Number(p.price),
      unit: (p.unit_name || "piece"), // 'kg' or 'piece' or other
      category: p.category || "Boshqa",
      emoji: p.emoji || "🍽️",
      image_url: p.image_url || null
    }));
    const set = new Set();
    PRODUCTS.forEach(p => set.add(p.category));
    CATEGORIES = Array.from(set);
    console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
  } catch (e) {
    console.error("loadProducts exception:", e);
    PRODUCTS = [];
    CATEGORIES = [];
  }
}
await loadProducts();
setInterval(() => loadProducts().catch(console.error), 1000*60*5); // refresh every 5 min

// --- Keyboards ---
function mainMenuKeyboard(){
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}
function categoriesKeyboard(){
  const buttons = CATEGORIES.map((c,i)=> Markup.button.callback(c, `cat_${i}`));
  return Markup.inlineKeyboard(chunk(buttons,3));
}
function productsKeyboardForCategoryIndex(idx){
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);
  const rows = prods.map(p => [Markup.button.callback(`${p.emoji} ${p.name} — ${formatCurrency(p.price)}${p.unit==="kg" ? " so'm/kg" : " so'm"}`, `product_${p.id}`)]);
  // below products add cart & checkout
  rows.push([Markup.button.callback("🛒 Savatni ko'rish", "show_cart"), Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout")]);
  return Markup.inlineKeyboard(rows);
}

// --- Cart summary ---
function cartSummary(session){
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if (ci.unit === "piece") return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if (ci.unit === "kg") return `• ${ci.name} — ${ci.quantity.toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    if (ci.unit === "sum") return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
  });
  return { lines, total };
}

// --- PDF creation (phone shown instead of userId) ---
function createOrderPdf({ userId, phone, lines, total, deliveryType, address }){
  return new Promise((resolve, reject) => {
    try {
      const tmp = process.env.TMPDIR || "/tmp";
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmp, filename);
      const doc = new PDFDocument({ margin: 36 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
      doc.moveDown(0.2);
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.moveDown(0.2);
      doc.fontSize(11).text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil/Lokatsiya: ${address}`);
      doc.moveDown(0.6);

      doc.fontSize(12).text("Buyurtma tafsiloti:");
      doc.moveDown(0.4);
      lines.forEach(line => doc.fontSize(11).text(line));

      doc.moveDown(0.6);
      doc.fontSize(13).text(`Jami: ${formatCurrency(total)} so'm`, { align: "right" });
      doc.moveDown(1);
      doc.fontSize(11).text("Haridingiz uchun rahmat!", { align: "center" });

      doc.end();
      stream.on("finish", ()=> resolve(filepath));
      stream.on("error", err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// --- Handlers ---

// /start — require phone contact
bot.start(async (ctx) => {
  ensureSession(ctx);
  if (!ctx.session.phone) {
    await ctx.reply("Assalomu alaykum! Botni ishlatish uchun telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// accept contact messages
bot.on("contact", async (ctx) => {
  ensureSession(ctx);
  const phone = ctx.message?.contact?.phone_number;
  if (phone) {
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring.");
  }
});
// accept plain typed phone numbers
bot.hears(/^\+?\d{9,15}$/, async (ctx) => {
  ensureSession(ctx);
  const phone = ctx.message.text.trim();
  ctx.session.phone = phone;
  await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
});

// Show categories
bot.hears("🍏 Mahsulotlar", async (ctx) => {
  if (!CATEGORIES.length) return ctx.reply("Hozircha mahsulotlar mavjud emas.");
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

// category pressed
bot.action(/^cat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  if (idx<0 || idx>=CATEGORIES.length) return ctx.reply("Noto'g'ri bo'lim.");
  await ctx.reply(`📦 ${CATEGORIES[idx]}:`, productsKeyboardForCategoryIndex(idx));
});

// product pressed
bot.action(/^product_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");
  ensureSession(ctx);

  try {
    if (product.image_url) {
      await ctx.replyWithPhoto(product.image_url, { caption: `${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}` });
    } else {
      await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`);
    }
  } catch (e) {
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`);
  }

  ctx.session.pending = { productId: pid, unit: product.unit };
  if (product.unit === "piece") {
    return ctx.reply("Nechta dona olasiz?");
  } else {
    return ctx.reply("Necha kilogram yoki qancha so'mlik olasiz? (masalan: 0.5 yoki 2500)");
  }
});

// central text handler
bot.on("text", async (ctx) => {
  ensureSession(ctx);
  const txt = String(ctx.message.text || "").trim();

  // If pending selection
  if (ctx.session.pending) {
    const pending = ctx.session.pending;
    const product = PRODUCTS.find(p => p.id === pending.productId);
    if (!product) { ctx.session.pending=null; return ctx.reply("Mahsulot topilmadi, qayta tanlang."); }

    const raw = txt.toLowerCase().replace(/\s+/g, '');
    // allow "2500som", "2500 so'm", "0.5", "1.2kg", "3ta", "2 dona"
    const currencyWords = ["so'm","som","sum","soum","so`m"];
    const hasCurrency = currencyWords.some(w => raw.includes(w));
    const hasKgWord = raw.includes("kg") || raw.includes("кг") || raw.includes("kg.");
    const numberMatch = raw.match(/[\d.]+/);
    if (!numberMatch) return ctx.reply("Iltimos son yoki summa kiriting (masalan: 0.5 yoki 2500).");
    const num = parseFloat(numberMatch[0]);
    if (isNaN(num) || num <= 0) return ctx.reply("Iltimos to‘g‘ri son kiriting (masalan: 0.5 yoki 2500).");

    let unitType="", quantity=0, price=0;

    if (pending.unit === "piece") {
      // donalik: accept what user wrote, floor to integer
      const cnt = Math.max(1, Math.floor(num));
      unitType = "piece";
      quantity = cnt;
      price = product.price * quantity;
    } else {
      // kg product
      // Heuristics:
      // - if user used currency word => treat as sum
      // - else if contains kg word or has decimal point => treat as kg
      // - else if numeric >= 1000 => likely sum (people use som amounts)
      // - else default to kg
      if (hasCurrency) {
        unitType = "sum";
        price = Math.round(num);
        quantity = +(price / product.price);
      } else if (hasKgWord || String(numberMatch[0]).includes('.') ) {
        unitType = "kg";
        quantity = num;
        price = Math.round(quantity * product.price);
      } else if (num >= 1000) {
        unitType = "sum";
        price = Math.round(num);
        quantity = +(price / product.price);
      } else {
        // default to kg (so entering "1" -> 1 kg)
        unitType = "kg";
        quantity = num;
        price = Math.round(quantity * product.price);
      }
    }

    // push to cart
    ctx.session.cart.push({
      productId: product.id,
      name: product.name,
      unit: unitType,
      unitPrice: product.price,
      quantity,
      price,
      image_url: product.image_url || null
    });
    ctx.session.pending = null;

    const { lines, total } = cartSummary(ctx.session);
    // reply and show categories to continue shopping
    await ctx.reply(`${product.name} savatchaga qo‘shildi ✅\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm\n\nHaridlarni davom ettiring👇🏻`, categoriesKeyboard());
    return;
  }

  // Not pending -> handle main commands
  if (txt === "🛒 Savatim" || txt.toLowerCase()==="/cart" ) {
    const { lines, total } = cartSummary(ctx.session);
    if (!lines.length) return ctx.reply("Savatcha bo'sh!");
    return ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
    ]));
  }

  if (txt === "📍 Do'kon manzili") {
    return ctx.reply(`🏬 Do'kon manzili:\n${STORE_LOCATION}`);
  }
  if (txt === "📞 Sotuvchi bilan bog'lanish") {
    return ctx.reply(`📱 Sotuvchi: ${CONTACT_PHONE}`);
  }
  if (txt === "🎁 Maxsus takliflar") {
    if (SPECIAL_OFFERS.length) return ctx.reply(`🎉 Maxsus takliflar:\n${SPECIAL_OFFERS.join("\n")}`);
    return ctx.reply("Hozircha maxsus takliflar yo'q 😊");
  }
  if (txt === "💳 Qarzlarim") {
    // placeholder: if you store debts in supabase, fetch here
    return ctx.reply("Sizda qarz yo'q ✅");
  }

  // fallback
  return ctx.reply("Menyudan tanlang yoki mahsulot miqdorini kiriting.");
});

// show cart action
bot.action("show_cart", async (ctx) => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  return ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
  ]));
});

// clear cart
bot.action("clear_cart", async (ctx) => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.cart = [];
  await ctx.reply("Savatcha tozalandi ✅");
});

// start checkout
bot.action("start_checkout", async (ctx) => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  await ctx.reply("Buyurtmani qanday olmoqchisiz?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "choose_delivery_delivery")],
    [Markup.button.callback("🏬 Olib ketish", "choose_delivery_pickup")]
  ]));
});

// pickup
bot.action("choose_delivery_pickup", async (ctx) => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkoutType = "pickup";
  const { lines, total } = cartSummary(ctx.session);
  const phone = ctx.session.phone || "Noma'lum";
  const pdfPath = await createOrderPdf({ userId: ctx.from.id, phone, lines, total, deliveryType: "Olib ketish", address: STORE_LOCATION });
  await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma (olib ketish)\nTelefon: ${phone}\nJami: ${formatCurrency(total)} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: pdfPath, filename: path.basename(pdfPath) });
  await ctx.reply(`🏬 Mahsulotlar tayyor! Olib ketishingiz mumkin 👍🏼\nDo'kon manzili: ${STORE_LOCATION}`);
  ctx.session.cart = [];
  ctx.session.checkoutType = null;
  try{ fs.unlinkSync(pdfPath); }catch(e){}
});

// delivery: request location
bot.action("choose_delivery_delivery", async (ctx) => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkoutType = "delivery";
  await ctx.reply("Iltimos, lokatsiyangizni yuboring:", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yuborish")]
  ]).resize());
});

// on location (for delivery)
bot.on("location", async (ctx) => {
  ensureSession(ctx);
  if (ctx.session.checkoutType !== "delivery") {
    return ctx.reply("Lokatsiya qabul qilindi. Agar buyurtma jarayonida lokatsiya yuborgan bo'lsangiz, davom eting.");
  }
  ctx.session.location = ctx.message.location;
  const { lines, total } = cartSummary(ctx.session);
  const phone = ctx.session.phone || "Noma'lum";
  const address = `https://www.google.com/maps?q=${ctx.session.location.latitude},${ctx.session.location.longitude}`;

  const pdfPath = await createOrderPdf({ userId: ctx.from.id, phone, lines, total, deliveryType: "Yetkazib berish", address });

  // send to admin
  await ctx.telegram.sendMessage(ADMIN_ID, `📍 Yangi yetkazib berish buyurtmasi\nTelefon: ${phone}\nLokatsiya: ${address}\nJami: ${formatCurrency(total)} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: pdfPath, filename: path.basename(pdfPath) });

  // ask for payment screenshot (card)
  await ctx.reply(`To'lov uchun karta raqam: ${CARD_NUMBER}\nTo'lovni amalga oshirib, skreenshotini yuboring.`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ To'lovni tasdiqlash (admin)", "confirm_payment")]
  ]));

  try{ fs.unlinkSync(pdfPath); }catch(e){}
});

// photo (screenshot) forwarded to admin
bot.on("photo", async (ctx) => {
  ensureSession(ctx);
  // only handle if in checkout flow
  if (!ctx.session.checkoutType) return ctx.reply("Rasm qabul qilindi.");
  const photos = ctx.message.photo;
  const largest = photos[photos.length-1];
  const file_id = largest.file_id;
  const who = ctx.from.username || ctx.from.first_name || ctx.from.id;
  await ctx.telegram.sendPhoto(ADMIN_ID, file_id, { caption: `📌 To'lov screenshots (from ${who}). Telefon: ${ctx.session.phone || "Noma'lum"}` });
  await ctx.reply("To'lov screenshots qabul qilindi. Admin tomonidan tekshiriladi. ✅");
});

// admin confirm payment action
bot.action("confirm_payment", async (ctx) => {
  await ctx.answerCbQuery();
  // Admin will press this inside admin account; but we also provide for user flow: we just acknowledge
  // If admin pressed, notify user that order is accepted
  // For simplicity, we'll assume admin presses in admin account; bot then should notify user(s)
  await ctx.reply("To'lov tasdiqlash tugmasi bosildi. Agar bu admin bo'lsa, buyurtma tasdiqlanadi va mijozga habar boradi.");
});

// send order to admin helper (if needed elsewhere)
async function sendOrderToAdmin(ctx){
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  const phone = ctx.session.phone || "Noma'lum";
  const address = ctx.session.location ? `https://www.google.com/maps?q=${ctx.session.location.latitude},${ctx.session.location.longitude}` : STORE_LOCATION;
  const pdfPath = await createOrderPdf({ userId: ctx.from.id, phone, lines, total, deliveryType: ctx.session.checkoutType || "—", address });
  await ctx.telegram.sendMessage(ADMIN_ID, `📦 Yangi buyurtma\nTelefon: ${phone}\n${address ? "Lokatsiya: " + address+"\n":""}Jami: ${formatCurrency(total)} so'm`);
  await ctx.telegram.sendDocument(ADMIN_ID, { source: pdfPath, filename: path.basename(pdfPath) });
  try{ fs.unlinkSync(pdfPath); }catch(e){}
}

// miscellaneous buttons
bot.hears("📍 Do'kon manzili", async (ctx) => ctx.reply(`🏬 Do'kon manzili:\n${STORE_LOCATION}`));
bot.hears("📞 Sotuvchi bilan bog'lanish", async (ctx) => ctx.reply(`📱 Sotuvchi: ${CONTACT_PHONE}`));
bot.hears("🎁 Maxsus takliflar", async (ctx) => {
  if (SPECIAL_OFFERS.length) return ctx.reply(`🎉 Maxsus takliflar:\n${SPECIAL_OFFERS.join("\n")}`);
  return ctx.reply("Hozircha maxsus takliflar yo'q 😊");
});
bot.hears("💳 Qarzlarim", async (ctx) => ctx.reply("Sizda qarz yo'q ✅"));

// admin command to reload products
bot.command("reload_products", async (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.reply("Faqat admin.");
  await loadProducts();
  return ctx.reply("Products qayta yuklandi.");
});

// error handling
bot.catch(err => console.error("Bot error:", err));

// launch
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀")).catch(e => console.error("Launch error:", e));

// graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
