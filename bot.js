import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";

// ==========================
// ENV
// ==========================
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Tekshirish (LOG)
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY ? "BOR" : "YO'Q");

// ==========================
// START - TELEFON OLISH
// ==========================
bot.start(async (ctx) => {
  // Userni bazaga qo‘shish
  await supabase.from("users").upsert({ id: ctx.from.id });

  ctx.reply(
    "Assalomu alaykum hurmatli mijoz! 😊\n\n" +
      "📱 Iltimos, telefon raqamingizni yuboring:",
    Markup.keyboard([
      Markup.button.contactRequest("📞 Raqamni yuborish")
    ]).resize()
  );
});

// ==========================
// TELEFON QABUL QILISH
// ==========================
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;

  await supabase.from("users").update({ phone }).eq("id", ctx.from.id);

  ctx.reply(
    "Quyidagi bo‘limlardan birini tanlang:",
    Markup.removeKeyboard()
  );

  return sendCategories(ctx);
});

// ==========================
// KATEGORIYALAR MENUSI
// ==========================
async function sendCategories(ctx) {
  const categories = [
    "Mevalar 🍎",
    "Ichimliklar 🥤",
    "Sut mahsulotlari 🥛",
    "Kolbasalar 🌭",
    "Sabzavotlar 🥕",
    "Shirinliklar 🍫",
    "Non mahsulotlari 🍞",
    "Go‘sht mahsulotlari 🥩"
  ];

  return ctx.reply(
    "📦 Bo‘limni tanlang:",
    Markup.inlineKeyboard(
      categories.map((c) => [Markup.button.callback(c, "cat_" + c)])
    )
  );
}

// ==========================
// MAHSULOTLAR CHIQARISH
// ==========================
bot.action(/cat_(.+)/, async (ctx) => {
  const category = ctx.match[1];

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("category", category);

  if (!products || products.length === 0) {
    return ctx.answerCbQuery("Bu bo‘lim bo‘sh!", { show_alert: true });
  }

  let buttons = products.map((p) => [
    Markup.button.callback(`${p.name} — ${p.price} so‘m`, "prod_" + p.id)
  ]);

  ctx.reply(`📂 *${category}* bo‘limi:`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons }
  });
});

// ==========================
// MAHSULOTNI SAVATGA QO‘SHISH
// ==========================
bot.action(/prod_(\d+)/, async (ctx) => {
  const product_id = +ctx.match[1];
  const user_id = ctx.from.id;

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", product_id)
    .single();

  if (!product) {
    return ctx.answerCbQuery("Xatolik: mahsulot topilmadi!", { show_alert: true });
  }

  await supabase.from("cart").upsert(
    { user_id, product_id, quantity: 1 },
    { onConflict: "user_id,product_id" }
  );

  return ctx.answerCbQuery(
    `🛒 Savatga qo‘shildi:\n${product.name} — ${product.price} so‘m`,
    { show_alert: true }
  );
});

// ==========================
// SAVAT
// ==========================
bot.hears("🛒 Savat", async (ctx) => {
  await showCart(ctx);
});

async function showCart(ctx) {
  const user_id = ctx.from.id;

  const { data: items } = await supabase
    .from("cart")
    .select("quantity, products(name, price)")
    .eq("user_id", user_id);

  if (!items || items.length === 0) {
    return ctx.reply("🛒 Savatcha hozircha bo‘sh.");
  }

  let total = 0;
  let text = "🛒 *Savatdagilar:*\n\n";

  items.forEach((i) => {
    text += `• ${i.products.name} — ${i.products.price} so‘m × ${i.quantity}\n`;
    total += Number(i.products.price) * i.quantity;
  });

  text += `\n💰 *Jami:* ${total} so‘m`;

  ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[Markup.button.callback("✔️ Buyurtmani tasdiqlash", "confirm")]]
    }
  });
}

// ==========================
// BUYURTMA TASDIQLASH
// ==========================
bot.action("confirm", (ctx) => {
  ctx.reply(
    "📍 Iltimos, joylashuvingizni yuboring:",
    Markup.keyboard([Markup.button.locationRequest("📍 Lokatsiyani yuborish")]).resize()
  );
});

// ==========================
// LOKATSIYA QABUL QILISH
// ==========================
bot.on("location", async (ctx) => {
  const { latitude, longitude } = ctx.message.location;

  await supabase.from("users").update({ latitude, longitude }).eq("id", ctx.from.id);

  const shop = "https://maps.app.goo.gl/CmNSNouqpqDdZS6X7?g_st=ic";

  ctx.reply(`📦 Buyurtmangiz qabul qilindi!\n🏪 Do‘konimiz manzili:\n${shop}`);
  ctx.reply("🔄 Yana xarid qilish uchun /start bosing");
  ctx.reply("🛍 Rahmat!");
});

// ==========================
bot.launch();
console.log("Bot ishga tushdi 🚀");
