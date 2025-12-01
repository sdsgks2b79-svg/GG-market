// ===========================
//        MAIN IMPORTS
// ===========================
import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const bot = new Telegraf(process.env.BOT_TOKEN);

const adminId = Number(process.env.ADMIN_ID);

// ===========================
//      SUPABASE CLIENT
// ===========================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===========================
//       SESSION (MEMORY)
// ===========================
const session = {};

function getUser(ctx) {
  const id = ctx.from.id;
  if (!session[id]) {
    session[id] = {
      phone: null,
      step: null,
      cart: [],
      category: null,
      selectedProduct: null,
      tempOrder: {},
      debt: 0,
    };
  }
  return session[id];
}

// ===========================
//      MAIN MENU BUTTONS
// ===========================
function mainMenu() {
  return Markup.keyboard([
    ["🛒 Mahsulotlar", "🧺 Savatim"],
    ["📍 Do'kon manzili", "📞 Sotuvchi bilan aloqa"],
    ["🎁 Maxsus takliflar", "💳 Qarzlarim"],
    ["/start"]
  ]).resize();
}

// ===========================
//      START COMMAND
// ===========================
bot.start(async (ctx) => {
  const user = getUser(ctx);

  // Telefon kiritilmagan bo'lsa — majburiy
  if (!user.phone) {
    return ctx.reply(
      "📱 Telefon raqamingizni yuboring:\n\n👉 Quyidagi tugmani bosing:",
      Markup.keyboard([
        Markup.button.contactRequest("📲 Telefon raqamni yuborish")
      ]).resize()
    );
  }

  ctx.reply("Menyudan birini tanlang 👇", mainMenu());
});

// ===========================
//   TELEFON QABUL QILISH
// ===========================
bot.on("contact", async (ctx) => {
  const user = getUser(ctx);
  user.phone = ctx.message.contact.phone_number;

  ctx.reply("Rahmat! 😊 Endi menyudan tanlang:", mainMenu());
});

// ===========================
//     MAHSULOTLAR BO‘LIMI
// ===========================
const categoryButtons = Markup.keyboard([
  ["🥤 Ichimliklar", "🍎 Mevalar", "🥕 Sabzavotlar"],
  ["🍬 Shirinliklar", "🥯 Non mahsulotlari", "🥩 Kolbasa va go‘sht"],
  ["🧼 Yuvish vositalari", "🔙 Orqaga"]
]).resize();

bot.hears("🛒 Mahsulotlar", (ctx) => {
  ctx.reply("Bo‘lim tanlang:", categoryButtons);
});

// ===========================
//  BO'LIMGA MOS MAHSULOTLARNI CHIQARISH
// ===========================
bot.hears([
  "🥤 Ichimliklar",
  "🍎 Mevalar",
  "🥕 Sabzavotlar",
  "🍬 Shirinliklar",
  "🥯 Non mahsulotlari",
  "🥩 Kolbasa va go‘sht",
  "🧼 Yuvish vositalari"
], async (ctx) => {

  const user = getUser(ctx);
  const selected = ctx.message.text;

  const pureCategory = selected.replace("🥤 ", "")
    .replace("🍎 ", "")
    .replace("🥕 ", "")
    .replace("🍬 ", "")
    .replace("🥯 ", "")
    .replace("🥩 ", "")
    .replace("🧼 ", "");

  user.category = pureCategory;

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("category", pureCategory);

  if (!products || products.length === 0) {
    return ctx.reply("Bu bo‘limda mahsulotlar yo‘q 😊");
  }

  let list = "Mahsulotlar:\n\n";
  products.forEach(p => {
    list += `${p.emoji || "📦"} *${p.name}* — ${p.price} so'm (${p.unit})\n`;
  });

  await ctx.reply(list, { parse_mode: "Markdown" });

  const buttons = products.map((p) => [p.name]);
  buttons.push(["🔙 Orqaga"]);

  ctx.reply("Tanlang:", Markup.keyboard(buttons).resize());
});

// ===========================
//  MAHSULOTNI TANLASH
// ===========================
bot.on("text", async (ctx) => {
  const user = getUser(ctx);
  const text = ctx.message.text;

  if (text === "🔙 Orqaga") {
    user.category = null;
    user.selectedProduct = null;
    return ctx.reply("Menyudan tanlang:", mainMenu());
  }

  if (!user.category) return;

  // Mahsulotni topamiz
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("name", text)
    .single();

  if (!product) return;

  user.selectedProduct = product;

  ctx.reply(
    `Necha *${product.unit}* olasiz?\n\nNarx: ${product.price} so'm / ${product.unit}\nMisol:\n👉 2\n👉 1.5\n👉 7000`,
    { parse_mode: "Markdown" }
  );

  user.step = "enter_amount";
});

// ===========================
//   MIQDOR KIRITISH (KG/DONA)
// ===========================
bot.hears(/^[0-9.]+$/, async (ctx) => {
  const user = getUser(ctx);

  if (user.step !== "enter_amount") return;

  const qty = Number(ctx.message.text);
  const product = user.selectedProduct;

  let amount = 0;

  if (qty < 50) {
    amount = qty * product.price;
  } else {
    amount = qty; // summada kiritdi
  }

  user.cart.push({
    id: product.id,
    name: product.name,
    unit: product.unit,
    qty: qty,
    total: amount
  });

  ctx.reply(
    `Savatga qo‘shildi:\n${product.name}\nMiqdor: ${qty} ${product.unit}\nSumma: ${amount} so'm`,
    mainMenu()
  );

  user.step = null;
  user.selectedProduct = null;
});

// ===========================
//       SAVATNI KO‘RISH
// ===========================
bot.hears("🧺 Savatim", (ctx) => {
  const user = getUser(ctx);

  if (user.cart.length === 0) return ctx.reply("Savat bo‘sh 😊");

  let text = "🧺 *Savat:* \n\n";

  let total = 0;
  user.cart.forEach((i) => {
    text += `${i.name} — ${i.qty}${i.unit} = ${i.total} so'm\n`;
    total += i.total;
  });

  text += `\n*Jami: ${total} so'm*\n\n`;

  ctx.reply(text, {
    parse_mode: "Markdown",
    ...Markup.keyboard([
      ["🚚 Yetkazib berish", "🏪 Olib ketish"],
      ["🔙 Orqaga"]
    ]).resize()
  });
});

// ===========================
//  YETKAZIB BERISH / OLIB KETISH
// ===========================
bot.hears("🚚 Yetkazib berish", (ctx) => {
  const user = getUser(ctx);
  user.step = "send_location";

  ctx.reply("📍 Lokatsiyangizni yuboring:", Markup.keyboard([
    Markup.button.locationRequest("📍 Lokatsiyani yuborish"),
    ["🔙 Orqaga"]
  ]).resize());
});

bot.on("location", (ctx) => {
  const user = getUser(ctx);

  if (user.step !== "send_location") return;

  const loc = ctx.message.location;

  user.tempOrder.location = loc;

  // Adminga yuborish
  bot.telegram.sendMessage(
    adminId,
    `🆕 Yangi buyurtma!\n\n📱 Mijoz: ${user.phone}\n📍 Lokatsiya: https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
  );

  ctx.reply(
    "Yetkazib berish tasdiqlandi. Endi to‘lov turini tanlang:",
    Markup.keyboard([["💵 Naqd", "💳 Click"]]).resize()
  );

  user.step = "payment";
});

// Olib ketish
bot.hears("🏪 Olib ketish", (ctx) => {
  ctx.reply("Bizning manzil:\n\n📍 https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9");

  ctx.reply(
    "Haridingiz uchun rahmat! ❤️\n\n/start — qaytish"
  );
});

// ===========================
//      TO‘LOV TURI
// ===========================
bot.hears(["💵 Naqd", "💳 Click"], (ctx) => {
  ctx.reply("Haridingiz uchun rahmat! ❤️\nBuyurtma qabul qilindi.\n\n/start");
});

// ===========================
//         DO‘KON MANZILI
// ===========================
bot.hears("📍 Do'kon manzili", (ctx) => {
  ctx.reply("📍 Do‘kon manzili:\nhttps://maps.app.goo.gl/UFp7BaPwaaPxbWhW9");
});

// ===========================
//     SOTUVCHI BILAN ALOQA
// ===========================
bot.hears("📞 Sotuvchi bilan aloqa", (ctx) => {
  ctx.reply("📞 Sotuvchi: +998200012560");
});

// ===========================
//       MAXSUS TAKLIFLAR
// ===========================
bot.hears("🎁 Maxsus takliflar", async (ctx) => {
  const { data } = await supabase.from("offers").select("*");

  if (!data || data.length === 0) {
    return ctx.reply("Hozircha hech narsa yo‘q 😊");
  }

  let text = "🎁 Maxsus takliflar:\n\n";

  data.forEach(o => {
    text += `• ${o.title}\n`;
  });

  ctx.reply(text);
});

// ===========================
//          QARZLAR
// ===========================
bot.hears("💳 Qarzlarim", (ctx) => {
  const user = getUser(ctx);

  if (!user.debt || user.debt === 0)
    return ctx.reply("HECH NARSA!");

  ctx.reply(`Sizning qarzingiz: ${user.debt} so‘m`);
});

// ===========================
//       RUN BOT
// ===========================
bot.launch();
console.log("Bot ishlamoqda...");
