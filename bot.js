import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';

// Telegram va Supabase ma’lumotlari
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ========================
// Start va telefon raqami
// ========================
bot.start((ctx) => {
  ctx.reply(
    "Salom! Buyurtma berish uchun telefon raqamingizni yuboring:",
    Markup.keyboard([
      Markup.button.contactRequest("📞 Telefon raqamni yuborish")
    ]).resize()
  );
});

// Telefon raqamini qabul qilish
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  // Supabase users jadvaliga saqlash
  await supabase.from('users').upsert({
    id: userId,
    phone: phone
  });

  // Asosiy menyuga o'tish
  ctx.reply(
    "Rahmat! Endi bo‘limni tanlang:",
    Markup.keyboard([
      ["🛍 Mahsulotlar", "🛒 Savatcha"]
    ]).resize()
  );
});

// ========================
// Asosiy menyu
// ========================
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

// ========================
// Bo‘lim tanlash va mahsulotlar
// ========================
bot.hears(["🧴 Tozalash","🍎 Mevalar","🥤 Ichimliklar","🥛 Sut mahsulotlari","🥓 Kolbasalar"], async (ctx) => {
  const categoryMap = {
    "🧴 Tozalash": "Tozalash",
    "🍎 Mevalar": "Mevalar",
    "🥤 Ichimliklar": "Ichimliklar",
    "🥛 Sut mahsulotlari": "Sut mahsulotlari",
    "🥓 Kolbasalar": "Kolbasalar"
  };
  const category = categoryMap[ctx.message.text];

  console.log("Tanlangan category:", category); // Tekshirish uchun

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('category', category);

  console.log("Products array:", products); // Tekshirish uchun

  if (!products.length) return ctx.reply("Bu bo‘limda mahsulot yo‘q!");

  const buttons = products.map(p => Markup.button.callback(`${p.name} - ${p.price}₽`, `add_${p.id}`));
  ctx.reply("Mahsulotlarni tanlang:", Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// ========================
// Mahsulotni savatga qo‘shish
// ========================
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  await supabase.from('cart').upsert(
    { user_id: userId, product_id: productId, quantity: 1 },
    { onConflict: ['user_id','product_id'] }
  );

  ctx.answerCbQuery("Savatchaga qo‘shildi!");
});

// ========================
// Savatcha
// ========================
bot.hears("🛒 Savatcha", async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase
    .from('cart')
    .select(`quantity, products(name, price)`)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply("🛒 Savatcha bo'sh!");

  let text = "🛍 Savatchangiz:\n\n";
  cartItems.forEach(item => {
    text += `${item.products.name} — ${item.quantity} x ${item.products.price}\n`;
  });

  ctx.reply(
    text,
    Markup.inlineKeyboard([
      Markup.button.callback("✅ Tasdiqlash", "checkout")
    ])
  );
});

// ========================
// Tasdiqlash va yetkazib berish / olib ketish
// ========================
bot.action("checkout", (ctx) => {
  ctx.reply(
    "Yetkazib berish yoki olib ketishni tanlang:",
    Markup.inlineKeyboard([
      Markup.button.locationRequest("📍 Lokatsiyani yuborish"),
      Markup.button.callback("🏬 Olib ketish", "pickup")
    ])
  );
});

// Lokatsiya olindi
bot.on("location", (ctx) => {
  ctx.reply("Lokatsiya olindi! To‘lov tugmasi chiqadi.");
  ctx.reply(
    "💳 To‘lovni amalga oshirish",
    Markup.inlineKeyboard([
      Markup.button.url("To‘lov qilish (keyin qo‘shiladi)", "https://payme.uz/invoice/123456")
    ])
  );
});

// Olib ketish tugmasi
bot.action("pickup", (ctx) => {
  ctx.reply("Siz buyurtmani olib ketishingiz mumkin. To‘lovni keyin amalga oshiring.");
});

// ========================
// Botni ishga tushirish
// ========================
bot.launch();
console.log("Bot ishlamoqda...");
