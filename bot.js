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

if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN in environment");
}
if (!OPENAI_API_KEY) {
  console.warn("Warning: OPENAI_API_KEY not set. AI features will not work.");
}

// ---------- Klientlar ----------
const bot = new Telegraf(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ---------- Mahsulotlar (JSON) ----------
const PRODUCTS = [
  // Mevalar (kg)
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "Mevalar" },
  // Sut mahsulotlari (piece)
  { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "Sut mahsulotlari" },
  // Ichimliklar (piece)
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  // Kolbasalar (piece / paket)
  { id: 7, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "Kolbasalar" },
  // Shirinliklar
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "Shirinliklar" },
  { id: 9, name: "Non oddiy", price: 4000, unit: "piece", category: "Boshqa" }
];

// Kategoriyalar avtomatik olinadi
const CATEGORIES = Array.from(new Set(PRODUCTS.map(p => p.category)));

// ---------- Ichki xotira (in-memory). Agar xohlasangiz, Supabase bilan almashtiramiz ----------
const carts = new Map(); // userId -> [{ productId, productName, unitType, unitPrice, quantity, price }]
const userState = new Map(); // userId -> { mode, productId }

// ---------- Helper funksiyalar ----------
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function clearCart(userId) {
  carts.delete(userId);
}
function findProductById(id) {
  return PRODUCTS.find(p => Number(p.id) === Number(id));
}
function addOrReplaceInCart(userId, item) {
  // item: { productId, productName, unitType, unitPrice, quantity, price }
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
  return Markup.inlineKeyboard(chunkButtons(buttons, 1)); // one per row
}

// create PDF
function createPdfTempFile(userId, lines, total) {
  return new Promise((resolve, reject) => {
    try {
      const tmpDir = process.env.TMPDIR || "/tmp";
      if (!fs.existsSync(tmpDir)) {
        // fallback to current dir
        // ensure writable
      }
      const filename = `check_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tmpDir, filename);
      const doc = new PDFDocument({ margin: 30 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
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

// AI parser: call OpenAI to transform natural text to JSON items
async function aiParseOrderText(text) {
  if (!openai) return [];
  const prompt = `
Siz buyurtma parserisiz. Foydalanuvchi matnini o'qib, quyidagi JSON ro'yxatini qaytaring: 
[{"name":"<mahsulot nomi>", "quantity": <son yoki decimal>, "unit": "kg"|"piece"|"sum"} , ...]
Faqat JSON qaytaring, hech qanday izoh yoki boshqa matn bo'lmasin.

Qoida:
- "0.5 kg", "0.5kg" → unit = "kg", quantity = 0.5
- "2 dona", "2ta" → unit = "piece", quantity = 2
- "5000 so'm", "5000 som", "5000so'm" → unit = "sum", quantity = 5000 (pul)
Agar aniq aniqlay olmasangiz, skip qiling.

Input: ${JSON.stringify(text)}
  `;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    });
    const content = res.choices?.[0]?.message?.content || "";
    // try parse JSON anywhere in content
    let jsonText = content.trim();
    // often model returns code block - remove if present
    jsonText = jsonText.replace(/^[\s`]*json\r?\n?/i, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error("AI parse error:", e);
    return [];
  }
}

// ---------- Keyboards ----------
function mainMenuKeyboard() {
  // simple reply keyboard for main actions
  const rows = [
    ["📂 Bo'limlar", "🛒 Savatcha"],
    ["💡 Suniy intelekt (AI)", "/start"]
  ];
  return Markup.keyboard(rows).resize();
}

function categoriesInlineKeyboard() {
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [];
    row.push(Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`));
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1], `cat_${CATEGORIES[i + 1]}`));
    buttons.push(row);
  }
  buttons.push([Markup.button.callback("🛒 Savatcha", "show_cart"), Markup.button.callback("💡 Suniy intelekt (AI)", "ai_mode")]);
  return Markup.inlineKeyboard(buttons);
}

// ---------- Bot handlers ----------

// /start
bot.start(async (ctx) => {
  try {
    await ctx.reply("Assalomu alaykum! GG Market ga xush kelibsiz.\nTelefon raqamingizni yuborishingizni tavsiya qilamiz.", mainMenuKeyboard());
  } catch (e) {
    console.error(e);
  }
});

// show categories (reply)
bot.hears("📂 Bo'limlar", async (ctx) => {
  await ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());
});

// inline categories actions
CATEGORIES.forEach(cat => {
  bot.action(new RegExp(`^cat_${cat}$`), async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const products = PRODUCTS.filter(p => p.category === cat);
      if (!products.length) return ctx.reply("Bu bo'limda mahsulot yo'q.");
      const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit === "kg" ? " so'm/kg" : " so'm"}`, `add_${p.id}`));
      buttons.push(Markup.button.callback("🛒 Savatcha", "show_cart"));
      await ctx.reply(`📦 ${cat}:`, Markup.inlineKeyboard(chunkButtons(buttons, 1)));
    } catch (e) {
      console.error(e);
    }
  });
});

// add product pressed
bot.action(/add_(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const product = findProductById(productId);
    if (!product) return ctx.reply("Mahsulot topilmadi.");

    // If piece -> ask count
    if (product.unit === "piece") {
      userState.set(ctx.from.id, { mode: "await_count", productId: productId });
      return ctx.reply(`Nechta ${product.name} olasiz? (faqat butun son)`);
    }

    // If kg -> ask KG or Sum
    if (product.unit === "kg") {
      userState.set(ctx.from.id, { mode: "await_choice", productId: productId });
      return ctx.reply(
        `${product.name} ni qanday olasiz?`,
        Markup.inlineKeyboard([
          [Markup.button.callback("KG (kilogram)", `choice_kg_${productId}`), Markup.button.callback("SUMMA (so'm)", `choice_sum_${productId}`)],
          [Markup.button.callback("Bekor qilish", `choice_cancel_${productId}`)]
        ])
      );
    }

    // fallback
    userState.set(ctx.from.id, { mode: "await_count", productId: productId });
    return ctx.reply(`Nechta ${product.name} olasiz?`);
  } catch (e) {
    console.error(e);
  }
});

// KG / SUM choice handlers
bot.action(/choice_kg_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const pid = ctx.match[1];
  userState.set(ctx.from.id, { mode: "await_kg", productId: pid });
  return ctx.reply("Necha kilogram olasiz? (masalan: 0.5 yoki 1)");
});
bot.action(/choice_sum_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const pid = ctx.match[1];
  userState.set(ctx.from.id, { mode: "await_sum", productId: pid });
  return ctx.reply("Necha so'mlik olasiz? (masalan: 5000 yoki 25000)");
});
bot.action(/choice_cancel_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  userState.delete(ctx.from.id);
  return ctx.reply("Bekor qilindi.");
});

// Show cart inline
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
bot.action("clear_cart", async (ctx) => {
  await ctx.answerCbQuery();
  clearCart(ctx.from.id);
  return ctx.reply("Savatcha tozalandi ✅");
});

// Generate check (PDF) only for user
bot.action("generate_check", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");

  try {
    const filePath = await createPdfTempFile(userId, lines, total);
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
    // cleanup
    try { fs.unlinkSync(filePath); } catch (e) {}
  } catch (e) {
    console.error("PDF error:", e);
    return ctx.reply("Chek yaratishda xatolik yuz berdi.");
  }
});

// Confirm order -> send PDF to admin and user, then clear cart
bot.action("confirm_order", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const { lines, total } = cartSummary(userId);
  if (!lines.length) return ctx.reply("Savatcha bo'sh!");

  try {
    const filePath = await createPdfTempFile(userId, lines, total);

    // build admin message (we don't have saved phone in this JSON version)
    const adminText = `📦 Yangi buyurtma\nUserID: ${userId}\n\n${lines.join("\n")}\n\nJami: ${total.toLocaleString()} so'm`;
    await bot.telegram.sendMessage(ADMIN_ID, adminText);
    await bot.telegram.sendDocument(ADMIN_ID, { source: filePath, filename: path.basename(filePath) });

    await ctx.reply("✅ Buyurtma qabul qilindi! Adminga yuborildi.");
    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });

    // cleanup
    try { fs.unlinkSync(filePath); } catch (e) {}

    clearCart(userId);
  } catch (e) {
    console.error("confirm_order error:", e);
    return ctx.reply("Buyurtma yaratishda xatolik yuz berdi.");
  }
});

// AI mode button
bot.action("ai_mode", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply("Tabiiy tilda yozing: masalan 'Menga 2ta pepsi va 0.5 kg kartoshka qo'sh' — men avtomatik qo'shaman.");
});

// ---------- Single text handler (central) ----------
bot.on("text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  const userId = ctx.from.id;

  // 1) If user waiting state
  if (userState.has(userId)) {
    const state = userState.get(userId);
    const product = findProductById(state.productId);
    if (!product) {
      userState.delete(userId);
      return ctx.reply("Mahsulot topilmadi, qayta urining.");
    }

    // parse numeric value
    const normalized = text.replace(",", ".").replace(/[^0-9.]/g, "");
    const number = parseFloat(normalized);

    if (state.mode === "await_count") {
      const cnt = parseInt(text);
      if (isNaN(cnt) || cnt <= 0) return ctx.reply("Iltimos to'g'ri butun son kiriting (masalan: 1, 2).");
      const price = product.price * cnt;
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "piece", unitPrice: product.price, quantity: cnt, price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${cnt} dona savatchaga qo'shildi ✅`);
    }

    if (state.mode === "await_kg") {
      if (isNaN(number) || number <= 0) return ctx.reply("Iltimos to'g'ri kilogram kiriting (masalan: 0.5, 1)");
      const qty = number;
      const price = Math.round(product.price * qty);
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "kg", unitPrice: product.price, quantity: qty, price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${qty} kg savatchaga qo'shildi ✅ (yakuniy: ${price.toLocaleString()} so'm)`);
    }

    if (state.mode === "await_sum") {
      if (isNaN(number) || number <= 0) return ctx.reply("Iltimos to'g'ri summa kiriting (masalan: 5000)");
      const money = Math.round(number);
      const qty = money / product.price;
      const price = money;
      addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "sum", unitPrice: product.price, quantity: qty, price });
      userState.delete(userId);
      return ctx.reply(`${product.name} — ${money.toLocaleString()} so'mlik savatchaga qo'shildi ✅ (≈${qty.toFixed(2)} kg)`);
    }

    // unknown state
    userState.delete(userId);
    return ctx.reply("Kutilmagan holat — qayta urinib ko'ring.");
  }

  // 2) Built-in commands / simple text
  if (text === "🛒 Savatcha" || text.toLowerCase() === "/cart") {
    const { lines, total } = cartSummary(userId);
    if (!lines.length) return ctx.reply("🛒 Savatcha bo'sh!");
    return ctx.replyWithMarkdown(`🛍 *Sizning savatchangiz:*\n\n${lines.join("\n")}\n\n*Jami:* ${total.toLocaleString()} so'm`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtmani tasdiqlash", "confirm_order"), Markup.button.callback("📄 Chek chiqarish", "generate_check")],
      [Markup.button.callback("🗑️ Savatchani tozalash", "clear_cart")]
    ]));
  }

  if (text === "📂 Bo'limlar") {
    return ctx.reply("Bo'limlarni tanlang:", categoriesInlineKeyboard());
  }

  if (text === "💡 Suniy intelekt (AI)" || text.toLowerCase().startsWith("/ai")) {
    // if /ai immediate query: /ai savol
    if (text.toLowerCase().startsWith("/ai")) {
      const q = text.replace(/^\/ai\s*/i, "").trim();
      if (!q) return ctx.reply("Iltimos, /ai so'zidan keyin savolingizni yozing.");
      if (!openai) return ctx.reply("AI ishlamayapti — OPENAI_API_KEY yoqilmagan.");
      try {
        const r = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: q }],
          max_tokens: 500
        });
        const answer = r.choices?.[0]?.message?.content || "AI javob topilmadi.";
        return ctx.reply(answer);
      } catch (e) {
        console.error("AI error:", e);
        return ctx.reply("AI bilan bog'lanishda xatolik yuz berdi.");
      }
    } else {
      return ctx.reply("AI orqali buyurtma yuborish uchun tabiiy tilda yozing: masalan 'Menga 2ta pepsi va 0.5 kg kartoshka qo'sh'.");
    }
  }

  // 3) If message looks like shopping natural language, attempt AI parse and auto-add
  const looksLikeOrder = /\d/.test(text) && /[A-Za-z\u0400-\u04FF\u0600-\u06FF\u0620-\u06FF]/.test(text);
  if (looksLikeOrder && openai) {
    await ctx.reply("AI buyurtmani tahlil qilmoqda... ⏳");
    try {
      const parsed = await aiParseOrderText(text);
      if (!parsed || parsed.length === 0) return ctx.reply("AI buyurtmani tushunmadi. Iltimos aniqroq yozing yoki mahsulotni bo'limdan tanlang.");
      const added = [];
      for (const it of parsed) {
        const nameLower = (it.name || "").toLowerCase();
        // find product by fuzzy match
        const product = PRODUCTS.find(p => p.name.toLowerCase().includes(nameLower) || nameLower.includes(p.name.toLowerCase()));
        if (!product) {
          added.push(`❌ ${it.name} — mahsulot topilmadi`);
          continue;
        }
        if (it.unit === "piece") {
          const cnt = Math.max(1, Math.round(Number(it.quantity) || 1));
          const price = product.price * cnt;
          addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "piece", unitPrice: product.price, quantity: cnt, price });
          added.push(`✅ ${product.name} — ${cnt} dona`);
        } else if (it.unit === "kg") {
          const qty = Number(it.quantity) || 0;
          const price = Math.round(product.price * qty);
          addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "kg", unitPrice: product.price, quantity: qty, price });
          added.push(`✅ ${product.name} — ${qty} kg`);
        } else if (it.unit === "sum") {
          const money = Math.round(Number(it.quantity) || 0);
          const qty = money / product.price;
          addOrReplaceInCart(userId, { productId: product.id, productName: product.name, unitType: "sum", unitPrice: product.price, quantity: qty, price: money });
          added.push(`✅ ${product.name} — ${money.toLocaleString()} so'm (≈${qty.toFixed(2)} kg)`);
        } else {
          added.push(`❌ ${it.name} — birligini aniqlanmadi`);
        }
      }
      return ctx.reply(added.join("\n"));
    } catch (e) {
      console.error("AI parse error:", e);
      return ctx.reply("AI bilan tahlil qilishda xatolik yuz berdi.");
    }
  }

  // Default help
  return ctx.reply("Nimani xohlaysiz? Bo'limlardan tanlang yoki AI orqali tabiiy so'rov yozing (masalan: '2ta pepsi va 0.5 kg kartoshka').");
});

// ---------- Clean shutdown ----------
bot.launch()
  .then(() => console.log("Bot ishga tushdi 🚀"))
  .catch(err => console.error("Bot launch error:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
