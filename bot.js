import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ====================
// Start va telefon
// ====================
bot.start((ctx) => {
  ctx.reply(
    "Assalomu alaykum, qadrli mijozlarimiz! Do‘konimizga xush kelibsiz.\nIltimos, telefon raqamingizni yuboring:",
    Markup.keyboard([Markup.button.contactRequest("📞 Telefon raqamni yuborish")]).resize()
  );
});

bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({ id: userId, phone });

  ctx.reply("Rahmat! Endi bo‘limni tanlang:", Markup.keyboard([["🛍 Mahsulotlar","🛒 Savatcha"]]).resize());
});

// ====================
// Bo‘limlar
// ====================
const sections = [
  "🧴 Tozalash",
  "🍎 Mevalar",
  "🥤 Ichimliklar",
  "🥛 Sut mahsulotlari",
  "🥓 Kolbasalar",
  "🥖 Non va pishloqlar",
  "🍬 Shirinliklar",
  "🥜 Gazaklar",
  "🥗 Salatlar",
  "🔥 Maxsus takliflar"
];

const categoryMap = Object.fromEntries(sections.map(s => [s,s.replace(/^[^a-zA-Z]+/,"")]));

bot.hears("🛍 Mahsulotlar", (ctx) => {
  const keyboard = [sections.slice(0,3),sections.slice(3,6),sections.slice(6,9),sections.slice(9).concat(["⬅️ Orqaga"])];
  ctx.reply("Bo‘limni tanlang:", Markup.keyboard(keyboard).resize());
});

bot.hears("⬅️ Orqaga", (ctx) => {
  ctx.reply("Asosiy menyu:", Markup.keyboard([["🛍 Mahsulotlar","🛒 Savatcha"]]).resize());
});

// ====================
// Bo‘lim va mahsulot
// ====================
bot.hears(sections, async (ctx) => {
  const category = categoryMap[ctx.message.text];

  const { data: products, error } = await supabase.from('products').select('*').eq('category', category);
  if (error) return ctx.reply("Xatolik yuz berdi.");

  if (!products.length) return ctx.reply("Bu bo‘limda mahsulot yo‘q!");

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so'm`, `add_${p.id}`));
  ctx.reply("Mahsulotlarni tanlang:", Markup.inlineKeyboard(buttons,{columns:1}));
});

// ====================
// Mahsulotni savatchaga qo‘shish
// ====================
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  await supabase.from('cart').upsert(
    { user_id: userId, product_id: productId, quantity: 1 },
    { onConflict:['user_id','product_id'] }
  );

  ctx.answerCbQuery("Savatchaga qo‘shildi!");
});

// ====================
// Savatcha
// ====================
bot.hears("🛒 Savatcha", async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart').select('quantity, products(name, price)').eq('user_id', userId);

  if (!cartItems.length) return ctx.reply("🛒 Savatcha bo'sh!");

  let text = "🛍 Savatchangiz:\n\n";
  let total = 0;
  cartItems.forEach(item => { total += item.products.price*item.quantity; text += `${item.products.name} — ${item.quantity} x ${item.products.price} so'm\n`; });
  text += `\n💰 Jami: ${total} so'm`;

  ctx.reply(text, Markup.inlineKeyboard([Markup.button.callback("✅ Tasdiqlash","checkout")]));
});

// ====================
// Tasdiqlash va lokatsiya
// ====================
bot.action("checkout", (ctx) => {
  ctx.reply("Yetkazib berish yoki olib ketishni tanlang:", Markup.inlineKeyboard([
    Markup.button.locationRequest("📍 Lokatsiyani yuborish"),
    Markup.button.callback("🏬 Olib ketish","pickup")
  ]));
});

bot.on("location", async (ctx) => {
  const userId = ctx.from.id;
  const location = ctx.message.location;

  await supabase.from('users').upsert({id:userId, latitude:location.latitude, longitude:location.longitude});
  ctx.reply("Lokatsiya olindi! To‘lov tugmasi chiqadi.", Markup.inlineKeyboard([
    Markup.button.url("💳 To‘lov qilish (Payme/Click)","https://payme.uz/invoice/123456")
  ]));
});

bot.action("pickup", (ctx) => {
  ctx.reply("Siz buyurtmani olib ketishingiz mumkin.\nDo‘kon lokatsiyasi: https://maps.app.goo.gl/CmNSNouqpqDdZS6X7?g_st=ic\nTo‘lovni keyin amalga oshiring.");
});

// ====================
bot.launch();
console.log("Bot ishga tushdi...");
