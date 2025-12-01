import { Telegraf, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";

// ==========================
// BOT VA SUPABASE
// ==========================
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==========================
// START - TELEFON SO‘RASH
// ==========================
bot.start(async (ctx) => {
  await supabase.from("users").upsert({ id: ctx.from.id });
  ctx.reply(
    "Assalomu alaykum hurmatli mijoz! 😊\n\n📱 Iltimos, telefon raqamingizni yuboring:",
    Markup.keyboard([Markup.button.contactRequest("📞 Raqamni yuborish")]).resize()
  );
});

// ==========================
// TELEFON QABUL QILISH
// ==========================
bot.on("contact", async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  await supabase.from("users").update({ phone }).eq("id", ctx.from.id);
  ctx.reply("Quyidagi bo‘limlardan birini tanlang:", Markup.removeKeyboard());
  return sendCategories(ctx);
});

// ==========================
// BO‘LIMLAR + QIDIRUV
// ==========================
async function sendCategories(ctx) {
  const categories = [
    { name: "Mevalar", emoji: "🍎" },
    { name: "Sabzavotlar", emoji: "🥕" },
    { name: "Ichimliklar", emoji: "🥤" },
    { name: "Sut mahsulotlari", emoji: "🥛" },
    { name: "Kolbasalar", emoji: "🌭" },
    { name: "Shirinliklar", emoji: "🍫" },
    { name: "Non mahsulotlari", emoji: "🍞" },
    { name: "Go‘sht mahsulotlari", emoji: "🥩" }
  ];

  const buttons = categories.map(c => Markup.button.callback(`${c.name} ${c.emoji}`, "cat_" + c.name));

  const chunk = (arr, size) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
  };
  const inlineKeyboard = chunk(buttons, 2);

  // Doimiy Savat va Qidiruv knopkasi
  inlineKeyboard.push([
    Markup.button.callback("🛒 Savat", "show_cart"),
    Markup.button.callback("🔍 Qidiruv", "search")
  ]);

  return ctx.reply("📦 Bo‘limni tanlang:", Markup.inlineKeyboard(inlineKeyboard));
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

  if (!products || products.length === 0)
    return ctx.answerCbQuery("Bu bo‘lim bo‘sh!", { show_alert: true });

  const buttons = products.map(p => [
    Markup.button.callback(`${p.name} — ${p.price} so‘m`, "prod_" + p.id)
  ]);

  // Savatga qaytish + asosiy menyu
  buttons.push([Markup.button.callback("🏠 Asosiy menyu", "menu"), Markup.button.callback("🛒 Savat", "show_cart")]);

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

  if (!product) return ctx.answerCbQuery("Xatolik: mahsulot topilmadi!", { show_alert: true });

  // Agar Mevalar yoki Sabzavotlar bo‘limi => kg yoki pulga qarab so‘raysiz
  if (["Mevalar","Sabzavotlar"].includes(product.category)) {
    await ctx.reply(`🍏 *${product.name}* narxi: ${product.price} so‘m/kg\n\nNecha kg yoki necha so‘mlik kerak?`, { parse_mode: "Markdown" });
    // kontekstda saqlaymiz
    ctx.session = ctx.session || {};
    ctx.session.product_id = product_id;
    return;
  }

  // Oddiy 1 dona qo‘shish
  await supabase.from("cart").upsert(
    { user_id, product_id, quantity: 1 },
    { onConflict: "user_id,product_id" }
  );

  return ctx.answerCbQuery(`🛒 Savatga qo‘shildi:\n${product.name} — ${product.price} so‘m`, { show_alert: true });
});

// ==========================
// KG / PULGA QARAB QO‘SHISH
// ==========================
bot.on("text", async (ctx) => {
  if (!ctx.session || !ctx.session.product_id) return;

  let input = ctx.message.text.replace(",", "."); // 0.5 kabi
  let qty = parseFloat(input);

  if (isNaN(qty) || qty <= 0) return ctx.reply("❌ Iltimos, to‘g‘ri raqam kiriting (kg yoki so‘m).");

  const product_id = ctx.session.product_id;
  const user_id = ctx.from.id;

  const { data: product } = await supabase.from("products").select("*").eq("id", product_id).single();

  let quantity = qty;
  let price = qty;

  if (qty > 1000) { // agar foydalanuvchi pul kiritgan bo‘lsa (so‘mlik)
    quantity = qty / product.price; // necha kg oladi
    price = qty; // so‘m
  } else {
    price = product.price * qty;
  }

  await supabase.from("cart").upsert(
    { user_id, product_id, quantity },
    { onConflict: "user_id,product_id" }
  );

  ctx.session.product_id = null;

  return ctx.reply(`🛒 Savatga qo‘shildi:\n${product.name} — ${price.toLocaleString()} so‘m (${quantity} kg)`);
});

// ==========================
// QIDIRUV
// ==========================
bot.action("search", (ctx) => {
  ctx.reply("🔍 Qidiruv: mahsulot nomini yozing");
  ctx.session = ctx.session || {};
  ctx.session.searching = true;
});

bot.on("text", async (ctx) => {
  if (!ctx.session) ctx.session = {};
  if (ctx.session.searching) {
    const query = ctx.message.text;

    const { data: products } = await supabase
      .from("products")
      .select("*")
      .ilike("name", `%${query}%`);

    if (!products || products.length === 0) {
      ctx.session.searching = false;
      return ctx.reply("⚠️ Hech narsa topilmadi.");
    }

    const buttons = products.map(p => [
      Markup.button.callback(`${p.name} — ${p.price} so‘m`, "prod_" + p.id)
    ]);

    buttons.push([Markup.button.callback("🏠 Asosiy menyu", "menu"), Markup.button.callback("🛒 Savat", "show_cart")]);

    ctx.session.searching = false;
    return ctx.reply(`🔎 Natijalar:`, { reply_markup: { inline_keyboard: buttons } });
  }
});

// ==========================
// SAVATNI KO‘RISH
// ==========================
bot.action("show_cart", async (ctx) => {
  const user_id = ctx.from.id;

  const { data: items } = await supabase
    .from("cart")
    .select("quantity, products(name, price)")
    .eq("user_id", user_id);

  if (!items || items.length === 0) return ctx.reply("🛒 Savatcha hozircha bo‘sh.");

  let total = 0;
  let text = "🛒 *Savatdagilar:*\n\n";

  items.forEach(i => {
    text += `• ${i.products.name} — ${i.products.price} so‘m × ${i.quantity}\n`;
    total += Number(i.products.price) * i.quantity;
  });

  text += `\n💰 *Jami:* ${total.toLocaleString()} so‘m`;

  ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[Markup.button.callback("✔️ Buyurtmani tasdiqlash", "confirm")]]
    }
  });
});

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
