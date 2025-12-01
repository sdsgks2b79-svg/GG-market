import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Bo‘limlar
const categories = ['Mevalar', 'Sabzavotlar', 'Sut mahsulotlari', 'Kolbasalar', 'Ichimliklar', 'Shirinliklar'];

// Asosiy menyu
function mainMenuKeyboard() {
  return Markup.keyboard([
    ...categories.map(c => [c]),
    ['Savatcha 🛒', 'Qidiruv 🔍']
  ]).resize();
}

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
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', mainMenuKeyboard());
});

// Bo‘lim tanlash
bot.hears(categories, async (ctx) => {
  const category = ctx.message.text;
  const { data: products } = await supabase.from('products').select('*').eq('category', category);
  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// Mahsulotni savatga qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  const { error } = await supabase.from('cart').upsert({
    user_id: userId,
    product_id: productId,
    quantity: 1
  }, { onConflict: ['user_id', 'product_id'] });

  if (error) return ctx.reply('Xatolik yuz berdi ❌');
  ctx.answerCbQuery('Savatga qo‘shildi ✅');
});

// Savatcha tugmasi
bot.hears('Savatcha 🛒', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select(`quantity, products(name, price)`)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 Sizning savatchangiz:\n\n";
  cartItems.forEach(item => {
    text += `📦 ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Buyurtmani tasdiqlash', 'ask_check')
  ]));
});

// Chek chiqarilsinmi so‘rash
bot.action('ask_check', async (ctx) => {
  ctx.reply('Chek chiqarilsinmi?', Markup.inlineKeyboard([
    Markup.button.callback('Ha ✅', 'generate_check'),
    Markup.button.callback('Yo‘q ❌', 'confirm_no_check')
  ]));
});

// Chek bilan buyurtma
bot.action('generate_check', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select(`quantity, products(name, price)`)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savat bo‘sh ❌');

  // PDF yaratish
  const doc = new PDFDocument();
  const fileName = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(fileName));

  doc.fontSize(18).text('🛒 Sizning buyurtmangiz:', { align: 'center' });
  doc.moveDown();

  let total = 0;
  cartItems.forEach((item, i) => {
    const sum = item.quantity * item.products.price;
    total += sum;
    doc.text(`${i+1}. ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m = ${sum} so‘m`);
  });
  doc.moveDown();
  doc.text(`Umumiy: ${total} so‘m`, { align: 'right' });
  doc.end();

  ctx.replyWithDocument({ source: fs.createReadStream(fileName), filename: fileName });
  await supabase.from('cart').update({ status: 'confirmed' }).eq('user_id', userId);
});

// Cheksiz buyurtma
bot.action('confirm_no_check', async (ctx) => {
  const userId = ctx.from.id;
  await supabase.from('cart').update({ status: 'confirmed' }).eq('user_id', userId);
  ctx.reply('✅ Buyurtma qabul qilindi.');
});

// Lokatsiya qabul qilish
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// Qidiruv
bot.hears('Qidiruv 🔍', (ctx) => {
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

// Admin buyurtmalar
bot.command('orders', async (ctx) => {
  const { data: orders } = await supabase.from('cart')
    .select(`quantity, products(name, price), users(phone, latitude, longitude)`)
    .eq('status', 'confirmed');

  if (!orders.length) return ctx.reply('Hozircha buyurtma yo‘q.');

  let text = "📦 Barcha buyurtmalar:\n\n";
  orders.forEach((o, i) => {
    text += `${i+1}. ${o.products.name} — ${o.quantity} x ${o.products.price} so‘m\n`;
    text += `   Telefon: ${o.users.phone}\n`;
    text += `   Lokatsiya: https://www.google.com/maps?q=${o.users.latitude},${o.users.longitude}\n\n`;
  });

  ctx.reply(text);
});

// Bot ishga tushirish
bot.launch();
console.log('Bot ishlamoqda 🚀');
