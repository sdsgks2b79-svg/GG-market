import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';

// ====================
// Supabase va Telegram
// ====================
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ====================
// Start va telefon
// ====================
bot.start((ctx) => {
  ctx.reply(
    "Salom! Telefon raqamingizni yuboring:",
    Markup.keyboard([
      Markup.button.contactRequest("📞 Telefon raqamni yuborish")
    ]).resize()
  );
});

bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({
    id: userId,
    phone: phone
  });

  ctx.reply(
    "Rahmat! Endi bo‘limni tanlang:",
    Markup.keyboard([
      ["🛍 Mahsulotlar", "🛒 Savatcha"]
    ]).resize()
  );
});

// ====================
// Asosiy menyu
// ====================
bot.hears("🛍 Mahsulotlar", (ctx) => {
  ctx.reply(
    "Bo‘limni tanlang:",
    Markup.keyboard([
      ["🧴 Tozalash", "🍎 Mevalar"],
      ["🥤 Ichimliklar", "🥛 Sut mahsulotlari", "🥓 Kolbasalar"],
      ["⬅️ Orqaga"]
    ]).resize()
  );
});

bot.hears("⬅️ Orqaga", (ctx) => {
  ctx.reply(
    "Asosiy menyu:",
    Markup.keyboard([
      ["🛍 Mahsulotlar", "🛒 Savatcha"]
    ]).resize()
  );
});

// ====================
// Bo‘lim tanlash
// ====================
bot.hears(["🧴 Tozalash","🍎 Mevalar","🥤 Ichimliklar","🥛 Sut mahsulotlari","🥓 Kolbasalar"], async (ctx) => {
  const categoryMap = {
    "🧴 Tozalash": "Tozalash",
    "🍎 Mevalar": "Mevalar",
    "🥤 Ichimliklar": "Ichimliklar",
    "🥛 Sut mahsulotlari": "Sut mahsulotlari",
    "🥓 Kolbasalar": "Kolbasalar"
  };
  const category = categoryMap[ctx.message.text];

  console.log("Tanlangan category:", category);

  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('category', category);

  if (error) {
    console.log("Supabase error:", error);
    return ctx.reply("Xatolik yuz berdi. Admin bilan bog‘laning.");
  }

  console.log("Products array:", products);

  if (!products.length) return ctx.reply("Bu bo‘limda mahsulot yo‘q!");

  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} - ${p.price}₽`, `add_${p.id}`)
  );

  ctx.reply("Mahsulotlarni tanlang:", Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// ====================
// Mahsulotni savatchaga qo‘shish
// ====================
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  const { data, error } = await supabase.from('cart').upsert(
    { user_id: userId, product_id: productId, quantity: 1 },
    { onConflict: ['user_id','product_id'] }
  );

  console.log("Upsert error:", error);
  console.log("Upsert data:", data);

  ctx.answerCbQuery("Savatchaga qo‘shildi!");
});

// ====================
// Savatcha
// ====================
bot.hears("🛒 Savatcha", async (ctx) => {
  const userId = ctx.from.id;

  const { data: cartItems, error } = await supabase
    .from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  console.log("Cart error:", error);
  console.log("Cart items:", cartItems);

  if (!cartItems.length) return ctx.reply("🛒 Savatcha bo'sh!");

  let text = "🛍 Savatchangiz:\n\n";
  cartItems.forEach(item => {
    text += `${item.products.name} — ${item.quantity} x ${item.products.price}₽\n`;
  });

  ctx.reply(
    text,
    Markup.inlineKeyboard([
      Markup.button.callback("✅ Tasdiqlash", "checkout")
    ])
  );
});

// ====================
// Tasdiqlash / Lokatsiya
// ====================
bot.action("checkout", (ctx) => {
  ctx.reply(
    "Yetkazib berish yoki olib ketishni tanlang:",
    Markup.inlineKeyboard([
      Markup.button.locationRequest("📍 Lokatsiyani yuborish"),
      Markup.button.callback("🏬 Olib ketish", "pickup")
    ])
  );
});

bot.on("location", (ctx) => {
  ctx.reply("Lokatsiya olindi! To‘lov tugmasi chiqadi.");
  ctx.reply(
    "💳 To‘lovni amalga oshirish",
    Markup.inlineKeyboard([
      Markup.button.url("To‘lov qilish (keyin qo‘shiladi)", "https://payme.uz/invoice/123456")
    ])
  );
});

bot.action("pickup", (ctx) => {
  ctx.reply("Siz buyurtmani olib ketishingiz mumkin. To‘lovni keyin amalga oshiring.");
});

// ====================
// Bot ishga tushurish
// ====================
bot.launch();
console.log("Bot ishlamoqda...");
