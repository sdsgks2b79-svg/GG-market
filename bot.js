import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_ID = 123456789; // Sizning Telegram IDingiz

// Bo‘limlar emoji bilan
const categories = [
  { name: 'Mevalar', emoji: '🍎' },
  { name: 'Sabzavotlar', emoji: '🥦' },
  { name: 'Sut mahsulotlari', emoji: '🥛' },
  { name: 'Kolbasalar', emoji: '🥩' },
  { name: 'Ichimliklar', emoji: '🥤' },
  { name: 'Shirinliklar', emoji: '🍫' }
];

// Start
bot.start(async (ctx) => {
  ctx.reply(
    'Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz.\nIltimos, telefon raqamingizni yuboring:',
    Markup.keyboard([Markup.button.contactRequest('📱 Telefonni yuborish')]).oneTime().resize()
  );
});

// Telefon qabul qilish
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// Bo‘limlarni rangli tugmalar bilan
function categoryKeyboard() {
  return Markup.keyboard(categories.map(c => [`${c.emoji} ${c.name}`])).resize();
}

// Bo‘lim tanlash
bot.hears(categories.map(c => `${c.emoji} ${c.name}`), async (ctx) => {
  const text = ctx.message.text;
  const category = text.split(' ').slice(1).join(' ');
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

// Savatcha
bot.command('cart', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, product:products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = '🛍 *Sizning savatchangiz:*\n\n';
  let total = 0;
  cartItems.forEach(item => {
    const sum = item.quantity * item.product.price;
    total += sum;
    text += `📦 ${item.product.name} — ${item.quantity} x ${item.product.price} so‘m = ${sum} so‘m\n`;
  });

  text += `\nJami: ${total} so‘m`;

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('✅ Buyurtmani tasdiqlash', 'confirm_order'),
    Markup.button.callback('📝 Chek PDF chiqarish', 'pdf_check')
  ]));
});

// Buyurtmani tasdiqlash va adminga xabar
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, product:products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savat bo‘sh ❌');

  // Adminga xabar
  let text = `🛒 Yangi buyurtma!\n👤 ${ctx.from.first_name}\n📞 ${user.phone}\n\n`;
  let total = 0;
  cartItems.forEach((item, i) => {
    const sum = item.quantity * item.product.price;
    total += sum;
    text += `${i+1}. ${item.product.name} — ${item.quantity} x ${item.product.price} so‘m = ${sum} so‘m\n`;
  });
  text += `\nJami: ${total} so‘m\n🌍 Lokatsiya: https://www.google.com/maps?q=${user.latitude},${user.longitude}`;
  bot.telegram.sendMessage(ADMIN_ID, text);

  ctx.reply('Buyurtma qabul qilindi ✅ Adminga yuborildi.');
});

// PDF chek yaratish
bot.action('pdf_check', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, product:products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh ❌');

  const filePath = `check_${userId}.pdf`;
  const doc = new PDFDocument();
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(18).text('🛒 Buyurtma Cheki', { align: 'center' });
  doc.moveDown();

  let total = 0;
  cartItems.forEach((item, i) => {
    const sum = item.quantity * item.product.price;
    total += sum;
    doc.fontSize(14).text(`${i+1}. ${item.product.name} — ${item.quantity} x ${item.product.price} so‘m = ${sum} so‘m`);
  });

  doc.moveDown();
  doc.fontSize(16).text(`Jami: ${total} so‘m`, { align: 'right' });
  doc.end();

  writeStream.on('finish', () => {
    ctx.reply('Chek tayyor ✅', Markup.inlineKeyboard([
      Markup.button.url('📄 Chekni yuklab olish', `https://your-server.com/${filePath}`)
    ]));
  });
});

// Lokatsiya qabul qilish
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// Qidiruv
bot.command('search', async (ctx) => {
  ctx.reply('Qidiriladigan mahsulot nomini yozing:');
  bot.on('text', async (ctx2) => {
    const query = ctx2.message.text;
    const { data: products } = await supabase.from('products')
      .select('*')
      .ilike('name', `%${query}%`);
    if (!products.length) return ctx2.reply('Hech narsa topilmadi 😔');

    const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
    ctx2.reply('Natijalar:', Markup.inlineKeyboard(buttons, { columns: 1 }));
  });
});

// Botni ishga tushurish
bot.launch();
console.log('Bot ishlamoqda 🚀');
