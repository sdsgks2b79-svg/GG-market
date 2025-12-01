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
const CLICK_PAY_URL = process.env.CLICK_PAY_URL || null;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !ADMIN_ID) {
  throw new Error("Iltimos .env ga BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY, ADMIN_ID kiriting");
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global product/cache
let PRODUCTS = [];   // Supabase dan yuklangan mahsulotlar
let CATEGORIES = []; // kategoriyalar (yozilgan tartibda)

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
  if (!ctx.session.cart) ctx.session.cart = []; // [{ productId, name, unit, unitPrice, quantity, price, image_url }]
  return ctx.session;
}

// Load products from Supabase
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*");
  if (error) {
    console.error("Supabase products load error:", error);
    PRODUCTS = [];
    CATEGORIES = [];
    return;
  }
  PRODUCTS = data.map(p => ({
    id: Number(p.id),
    name: p.name,
    price: Number(p.price),
    unit: p.unit,         // "kg" yoki "piece" yoki "sum" (agar ishlatilsa)
    category: p.category,
    image_url: p.image_url || null
  }));
  const set = new Set();
  PRODUCTS.forEach(p => set.add(p.category));
  CATEGORIES = Array.from(set);
  console.log(`Loaded ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);
}
await loadProducts(); // yuklash dastlab

// Periodic refresh (optional) - har 5 daqiqada yangilanadi
setInterval(() => {
  loadProducts().catch(e => console.error(e));
}, 1000 * 60 * 5);

// Keyboards
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["🍏 Mahsulotlar", "🛒 Savatim", "📞 Sotuvchi bilan bog'lanish"],
    ["📍 Do'kon manzili", "🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

function categoriesKeyboard() {
  const buttons = CATEGORIES.map((c, i) => Markup.button.callback(`${c}`, `cat_${i}`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 3));
}

function productsKeyboardForCategoryIndex(idx) {
  const cat = CATEGORIES[idx];
  const prods = PRODUCTS.filter(p => p.category === cat);
  const buttons = prods.map(p => Markup.button.callback(`${p.name} — ${formatCurrency(p.price)}${p.unit==="kg"? " so'm/kg":" so'm"}`, `product_${p.id}`));
  buttons.push(Markup.button.callback("🔙 Ortga", `back_main`));
  return Markup.inlineKeyboard(chunkButtons(buttons, 1));
}

// PDF yaratish
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
      doc.moveDown(0.5);
      const now = new Date();
      doc.fontSize(10).text(`Sana: ${now.toLocaleDateString()}    Vaqt: ${now.toLocaleTimeString()}`);
      doc.text(`Telefon: ${phone || "Noma'lum"}`);
      if (deliveryType) doc.text(`Yetkazib berish turi: ${deliveryType}`);
      if (address) doc.text(`Manzil / Lokatsiya: ${address}`);
      doc.moveDown();

      doc.fontSize(12).text("Buyurtma tafsiloti:");
      doc.moveDown(0.4);

      lines.forEach(line => {
        doc.fontSize(11).text(line);
      });

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

// Helper cart summary
function cartSummary(session) {
  const cart = session.cart || [];
  let total = 0;
  const lines = cart.map(ci => {
    total += Number(ci.price);
    if (ci.unit === "piece") {
      return `• ${ci.name} — ${ci.quantity} dona × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    } else if (ci.unit === "kg") {
      return `• ${ci.name} — ${Number(ci.quantity).toFixed(2)} kg × ${formatCurrency(ci.unitPrice)} = ${formatCurrency(ci.price)} so'm`;
    } else { // sum or fallback
      return `• ${ci.name} — ${formatCurrency(ci.price)} so'm`;
    }
  });
  return { lines, total };
}

// ----------------- Handlers -----------------

// START: majburiy contact
bot.start(async ctx => {
  ensureSession(ctx);
  if (!ctx.session.phone) {
    await ctx.reply("Assalomu alaykum! Iltimos, telefon raqamingizni yuboring.", Markup.keyboard([
      [Markup.button.contactRequest("📲 Telefon raqamni yuborish")]
    ]).resize());
    return;
  }
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// contact qabul qilish
bot.on("contact", async ctx => {
  ensureSession(ctx);
  const phone = ctx.message?.contact?.phone_number;
  if (phone) {
    ctx.session.phone = phone;
    await ctx.reply(`Telefon saqlandi: ${phone}`, mainMenuKeyboard());
  } else {
    await ctx.reply("Kontakt topilmadi, iltimos qayta yuboring.");
  }
});

// Mahsulotlar menyusi
bot.hears("🍏 Mahsulotlar", async ctx => {
  if (!CATEGORIES.length) {
    await ctx.reply("Hozirda mahsulotlar mavjud emas.");
    return;
  }
  await ctx.reply("Bo'limni tanlang:", categoriesKeyboard());
});

// Category pressed (by index)
bot.action(/^cat_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const idx = Number(ctx.match[1]);
  if (idx < 0 || idx >= CATEGORIES.length) return ctx.reply("Noto'g'ri bo'lim.");
  await ctx.reply(`📦 ${CATEGORIES[idx]}:`, productsKeyboardForCategoryIndex(idx));
});

// Back to main
bot.action("back_main", async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply("Asosiy menyu:", mainMenuKeyboard());
});

// Product pressed => show image (if any) and ask quantity
bot.action(/^product_(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const pid = Number(ctx.match[1]);
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return ctx.reply("Mahsulot topilmadi.");

  ensureSession(ctx);
  // show photo if available
  try {
    if (product.image_url) {
      await ctx.replyWithPhoto(product.image_url, {
        caption: `${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`,
      });
    } else {
      await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`);
    }
  } catch (e) {
    // agar rasm yuborishda xato bo'lsa, faqat text yuboramiz
    await ctx.reply(`${product.name}\nNarx: ${formatCurrency(product.price)}${product.unit==="kg" ? " so'm/kg" : " so'm"}`);
  }

  // set session waiting state
  ctx.session.pending = { productId: pid, unit: product.unit };
  if (product.unit === "piece") {
    return ctx.reply(`Nechta dona olasiz? (butun son)`);
  } else { // kg
    return ctx.reply(`Necha kilogram yoki qancha so'mlik olasiz? (masalan: 0.5 yoki 2500)`);
  }
});

// Text handler: quantity or menu buttons
bot.on("text", async ctx => {
  ensureSession(ctx);
  const txt = ctx.message.text?.trim();
  if (!ctx.session.pending) {
    // main menu texts
    switch (txt) {
      case "🛒 Savatim":
      case "Savat":
      case "/cart":
      case "🛒 Savat":
        {
          const { lines, total } = cartSummary(ctx.session);
          if (!lines.length) return ctx.reply("Savatcha bo'sh!");
          await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
            [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
          ]));
          return;
        }
      case "📞 Sotuvchi bilan bog'lanish":
        return ctx.reply("Sotuvchi: +998200012560");
      case "📍 Do'kon manzili":
        return ctx.reply("Do'kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic");
      case "🎁 Maxsus takliflar":
      case "⭐ Maxsus takliflar":
        return ctx.reply("Hozircha hech narsa yo'q 😊");
      case "💳 Qarzlarim":
        // example: no debts implemented in Supabase here; show placeholder
        return ctx.reply("Hozircha qarzingiz yo'q ✅");
      default:
        return ctx.reply("Menyudan tanlang yoki mahsulot miqdorini kiriting.");
    }
  }

  // If pending product selection
  const pending = ctx.session.pending;
  const product = PRODUCTS.find(p => p.id === pending.productId);
  if (!product) {
    ctx.session.pending = null;
    return ctx.reply("Mahsulot topilmadi, qayta tanlang.");
  }

  // parse numeric value from text
  const cleaned = txt.replace(",", ".").replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return ctx.reply("Iltimos to'g'ri son kiriting (masalan: 1, 0.5, 2500).");

  let quantity = 0;
  let price = 0;
  let unitType = "";

  if (pending.unit === "piece") {
    quantity = Math.round(num);
    price = product.price * quantity;
    unitType = "piece";
  } else { // kg
    // heuristic: agar kiritilgan son product.price dan kichik bo'lsa va foydalanuvchi pul yozgan bo'lishi mumkin
    if (num < product.price && !txt.includes(".") && !txt.includes(",")) {
      // bu ehtimol pul bo'ldi (masalan 2500), lekin ehtiyot bo'lsak: agar pul kiritilganda bu pul bo'lsin
      // safer: treat as sum if num < price
      const sum = Math.round(num);
      quantity = +(sum / product.price);
      price = sum;
      unitType = "sum";
    } else if (txt.toLowerCase().includes("so") || txt.toLowerCase().includes("sum") || txt.toLowerCase().includes("so'm")) {
      const sum = Math.round(num);
      quantity = +(sum / product.price);
      price = sum;
      unitType = "sum";
    } else {
      // treat as kg
      quantity = num;
      price = Math.round(product.price * quantity);
      unitType = "kg";
    }
  }

  // push to cart in session
  ctx.session.cart.push({
    productId: product.id,
    name: product.name,
    unit: unitType,
    unitPrice: product.price,
    quantity,
    price,
    image_url: product.image_url || null
  });

  // clear pending
  ctx.session.pending = null;

  const { lines, total } = cartSummary(ctx.session);
  await ctx.reply(`${product.name} savatchaga qo'shildi ✅\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("🛒 Savatni ko'rish", "show_cart"), Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout")]
  ]));
});

// Show cart via action
bot.action("show_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  await ctx.reply(`🛍 Sizning savatchangiz:\n\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtmani tasdiqlash", "start_checkout"), Markup.button.callback("🗑️ Savatni tozalash", "clear_cart")]
  ]));
});

// clear cart
bot.action("clear_cart", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.cart = [];
  await ctx.reply("Savatcha tozalandi ✅");
});

// Start checkout
bot.action("start_checkout", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");
  // ask delivery type
  await ctx.reply("Buyurtmani qanday olmoqchisiz?", Markup.inlineKeyboard([
    [Markup.button.callback("🚚 Yetkazib berish", "choose_delivery_delivery"), Markup.button.callback("🏬 Olib ketish", "choose_delivery_pickup")]
  ]));
});

// choose delivery: delivery
bot.action("choose_delivery_delivery", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout = { delivery: "delivery" };
  // request location
  await ctx.reply("Iltimos lokatsiyangizni yuboring 📍", Markup.keyboard([
    [Markup.button.locationRequest("📍 Lokatsiyani yo'natish")]
  ]).resize());
});

// choose delivery: pickup
bot.action("choose_delivery_pickup", async ctx => {
  await ctx.answerCbQuery();
  ensureSession(ctx);
  ctx.session.checkout = { delivery: "pickup", address: "https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic" };
  // proceed to payment selection
  await ctx.reply(`Do'kon manzili: ${ctx.session.checkout.address}`);
  await askPaymentMethod(ctx);
});

// on location: save and notify admin
bot.on("location", async ctx => {
  ensureSession(ctx);
  if (!ctx.session.checkout || ctx.session.checkout.delivery !== "delivery") {
    return ctx.reply("Lokatsiyangiz uchun rahmat.");
  }
  const loc = ctx.message.location;
  ctx.session.checkout.address = `Lat:${loc.latitude},Lon:${loc.longitude}`;
  // notify admin with phone and map link
  const phone = ctx.session.phone || "Noma'lum";
  const mapLink = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
  await bot.telegram.sendMessage(ADMIN_ID, `📍 Yangi yetkazib berish buyurtmasi\nTelefon: ${phone}\nLokatsiya: ${mapLink}`);
  // proceed to payment
  await ctx.reply("Lokatsiyangiz qabul qilindi ✅");
  await askPaymentMethod(ctx);
});

// ask payment
async function askPaymentMethod(ctx) {
  await ctx.reply("To'lov usulini tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("💵 Naqd", "pay_cash"), Markup.button.callback("💳 Click", "pay_click")]
  ]));
}

// payment handlers
bot.action("pay_cash", async ctx => {
  await ctx.answerCbQuery();
  await finalizeOrder(ctx, "Naqd");
});
bot.action("pay_click", async ctx => {
  await ctx.answerCbQuery();
  // generate click link if CLICK_PAY_URL provided
  ensureSession(ctx);
  const { total } = cartSummary(ctx.session);
  if (CLICK_PAY_URL) {
    const link = `${CLICK_PAY_URL}${total}`;
    await ctx.reply(`Click orqali to'lash uchun havola: ${link}`);
  } else {
    await ctx.reply("Click to'lovni sozlanmagan (CLICK_PAY_URL .env ga qo'ying) — bu yerda faqat havola chiqadi.");
  }
  await finalizeOrder(ctx, "Click");
});

// finalize order: create pdf, send to user & admin, clear cart
async function finalizeOrder(ctx, paymentMethod) {
  ensureSession(ctx);
  const { lines, total } = cartSummary(ctx.session);
  if (!lines.length) return ctx.reply("Savat bo'sh!");
  const phone = ctx.session.phone || "Noma'lum";
  const deliveryType = ctx.session.checkout?.delivery === "pickup" ? "Olib ketish" : "Yetkazib berish";
  const address = ctx.session.checkout?.address || "";
  // create pdf
  try {
    const pdfPath = await createOrderPdf({
      userId: ctx.from.id,
      phone,
      lines,
      total,
      deliveryType,
      address
    });

    // send pdf to user
    await ctx.replyWithDocument({ source: pdfPath, filename: path.basename(pdfPath) });
    await ctx.reply("✅ Buyurtmangiz qabul qilindi. Tez orada yetkazib beramiz. /start", mainMenuKeyboard());

    // send to admin (message + pdf)
    const mapPart = address && address.startsWith("Lat:") ? `Lokatsiya: https://www.google.com/maps?q=${address.split("Lat:")[1].split(",Lon:")[0]},${address.split("Lon:")[1]}` : address;
    const adminText = `📦 Yangi buyurtma\nTelefon: ${phone}\nTo'lov: ${paymentMethod}\n${mapPart ? mapPart + "\n" : ""}\n${lines.join("\n")}\n\nJami: ${formatCurrency(total)} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID, adminText);
    await bot.telegram.sendDocument(ADMIN_ID, { source: pdfPath, filename: path.basename(pdfPath) });

    // cleanup
    try { fs.unlinkSync(pdfPath); } catch (e) {}
    ctx.session.cart = [];
    ctx.session.checkout = null;
  } catch (err) {
    console.error("Finalize order error:", err);
    return ctx.reply("Buyurtma yaratilishda xatolik yuz berdi.");
  }
}

// Admin manual reload products command (admin only)
bot.command("reload_products", async ctx => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.reply("Faqat admin.");
  await loadProducts();
  return ctx.reply("Products qayta yuklandi.");
});

// Fallback error log
bot.catch(err => {
  console.error("Bot error:", err);
});

// Launch
bot.launch().then(() => console.log("Bot ishga tushdi 🚀"))
  .catch(e => console.error("Launch error:", e));

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
