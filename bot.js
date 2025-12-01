import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import fs from 'fs';
import PDFDocument from 'pdfkit';

// Telegram va Supabase ulanishlari
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Admin ID
const ADMIN_ID = 8235655604;

// Bo‘limlar
const categories = [
  { name: 'Mevalar', emoji: '🍎' },
  { name: 'Sabzavotlar', emoji: '🥦' },
  { name: 'Sut mahsulotlari', emoji: '🧈' },
  { name: 'Kolbasalar', emoji: '🥩' },
  { name: 'Ichimliklar', emoji: '🥤' },
  { name: 'Shirinliklar', emoji: '🍫' }
];

// --- Start komandasi ---
bot.start((ctx) => {
  ctx.reply(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz.\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// --- Telefonni qabul qilish ---
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// --- Bo‘lim tugmalari ---
function categoryKeyboard() {
  const buttons = categories.map(c => [Markup.button.text(`${c.emoji} ${c.name}`)]);
  buttons.push([Markup.button.text('🧠 Suniy intelektdan yordam')]);
  buttons.push([Markup.button.text('🛒 Savatcha')]);
  return Markup.keyboard(buttons).resize();
}

// --- Bo‘lim tanlash ---
bot.hears(categories.map(c => `${c.emoji} ${c.name}`), async (ctx) => {
  const text = ctx.message.text;
  const category = text.slice(2); // emoji ni olib tashlash
  const { data: products } = await supabase.from('products').select('*').eq('category', category);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p =>
    Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`)
  );
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// --- Mahsulotni savatga qo‘shish ---
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

// --- Savatchani ko‘rsatish ---
bot.hears('🛒 Savatcha', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  cartItems.forEach((item, i) => {
    text += `${i+1}. ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('✅ Chek chiqarilsin', 'generate_check')
  ]));
});

// --- Chek PDF chiqarish ---
bot.action('generate_check', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh!');

  const doc = new PDFDocument();
  const fileName = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(fileName));

  doc.fontSize(20).text('🛒 Buyurtma Chek', { align: 'center' });
  doc.moveDown();

  let total = 0;
  cartItems.forEach((item, i) => {
    const line = `${i+1}. ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m\n`;
    doc.text(line);
    total += item.products.price * item.quantity;
  });
  doc.moveDown();
  doc.fontSize(16).text(`Jami: ${total} so‘m`);

  doc.end();
  doc.on('finish', () => {
    ctx.replyWithDocument({ source: fs.createReadStream(fileName), filename: fileName });
  });
});

// --- Lokatsiya qabul qilish ---
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// --- Suniy intelektdan yordam ---
bot.hears('🧠 Suniy intelektdan yordam', (ctx) => {
  ctx.reply('Savolingizni yozing, men AI orqali javob beraman:');

  bot.on('text', async (ctx2) => {
    const text = ctx2.message.text;
    if (text === '🧠 Suniy intelektdan yordam') return;
    const answer = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: text }]
    });
    ctx2.reply(answer.choices[0].message.content);
  });
});

// --- Admin buyurtmalarni ko‘rish ---
bot.hears('Admin: Buyurtmalar', async (ctx) => {
  if (ctx.from.id != ADMIN_ID) return;

  const { data: orders } = await supabase.from('cart')
    .select('quantity, products(name, price), users(phone, latitude, longitude)');

  if (!orders.length) return ctx.reply('Hozircha buyurtma yo‘q.');

  let text = "📦 Barcha buyurtmalar:\n\n";
  orders.forEach((o, i) => {
    text += `${i+1}. ${o.products.name} — ${o.quantity} x ${o.products.price} so‘m\n`;
    text += `   Telefon: ${o.users.phone}\n`;
    text += `   Lokatsiya: https://www.google.com/maps?q=${o.users.latitude},${o.users.longitude}\n\n`;
  });
  ctx.reply(text);
});

// --- Bot ishga tushurish ---
bot.launch();
console.log('Bot ishlamoqda 🚀');
