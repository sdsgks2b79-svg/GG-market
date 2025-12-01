import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Supabase ulanish
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Mijoz bo‘limlari
const categories = ['Mevalar', 'Sabzavotlar', 'Sut mahsulotlari', 'Kolbasalar', 'Ichimliklar', 'Shirinliklar'];

// Start komandasi
bot.start(async (ctx) => {
  ctx.replyWithMarkdown(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz.\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// Telefonni qabul qilish
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// Bo‘limlarni ko‘rsatish tugmalari
function categoryKeyboard() {
  return Markup.keyboard(categories.map(c => [c])).resize();
}

// Bo‘lim tanlash
bot.hears(categories, async (ctx) => {
  const category = ctx.message.text;
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('category', category);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// Mahsulotni savatga qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  // Default quantity = 1 kg / 1 dona
  const { error } = await supabase.from('cart').upsert({
    user_id: userId,
    product_id: productId,
    quantity: 1
  }, { onConflict: ['user_id', 'product_id'] });

  if (error) return ctx.reply('Xatolik yuz berdi ❌');

  ctx.answerCbQuery('Savatga qo‘shildi ✅');
});

// Savatchani ko‘rsatish
bot.command('cart', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select(`
      quantity,
      products(name, price)
    `)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  cartItems.forEach(item => {
    text += `📦 ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Buyurtmani tasdiqlash', 'confirm_order')
  ]));
});

// Buyurtmani tasdiqlash
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user.latitude || !user.longitude) {
    ctx.reply('Iltimos, lokatsiyangizni yuboring.', Markup.keyboard([Markup.button.locationRequest('Lokatsiyani yuborish')]).oneTime().resize());
    return;
  }
  ctx.reply(`Buyurtma qabul qilindi ✅\nLokatsiya: https://www.google.com/maps?q=${user.latitude},${user.longitude}`);
});

// Lokatsiyani qabul qilish
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// Qidiruv funksiyasi
bot.command('search', async (ctx) => {
  ctx.reply('Qidiriladigan mahsulot nomini yozing:');
  bot.on('text', async (ctx2) => {
    const query = ctx2.message.text;
    const { data: products } = await supabase.from('products')
      .select('*')
      .ilike('name', `%${query}%`);

    if (!products.length) return ctx2.reply('Hech narsa topilmadi 😔');

    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
    ctx2.reply(`Natijalar:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
  });
});

// Admin uchun buyurtmalarni ko‘rish
bot.command('orders', async (ctx) => {
  const { data: orders } = await supabase.from('cart')
    .select(`
      quantity,
      products(name, price),
      users(phone, latitude, longitude)
    `);

  if (!orders.length) return ctx.reply('Hozircha buyurtma yo‘q.');

  let text = "📦 Barcha buyurtmalar:\n\n";
  orders.forEach((o, i) => {
    text += `${i+1}. ${o.products.name} — ${o.quantity} x ${o.products.price} so‘m\n`;
    text += `   Telefon: ${o.users.phone}\n`;
    text += `   Lokatsiya: https://www.google.com/maps?q=${o.users.latitude},${o.users.longitude}\n\n`;
  });

  ctx.reply(text);
});

// Botni ishga tushirish
bot.launch();
console.log('Bot ishlamoqda 🚀');
