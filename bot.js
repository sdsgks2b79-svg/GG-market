import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const bot = new Telegraf('8457032858:AAGloYCKOyk6-iuj18LbWqd1DbM_BQZ7nB0');

const supabase = createClient(
  'https://vgtktugqrzcxyfgwpejn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZndGt0dWdxcnpjeHlmZ3dwZWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1MjE4MjUsImV4cCI6MjA4MDA5NzgyNX0.cRhBQleSApj4ld1cAWJBpCNV6UfhBgxKiZdDIjyYNgU'
);

const adminId = 8235655604;

// Bo‘limlar va stikerlar
const categories = [
  { key: 'Mevalar', sticker: '🍎' },
  { key: 'Sabzavotlar', sticker: '🥦' },
  { key: 'Sut mahsulotlari', sticker: '🥛' },
  { key: 'Kolbasalar', sticker: '🥩' },
  { key: 'Ichimliklar', sticker: '🥤' },
  { key: 'Shirinliklar', sticker: '🍰' },
];

// Start komandasi
bot.start(async (ctx) => {
  ctx.replyWithMarkdown(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz.\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// Telefon qabul qilish
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// Bo‘lim tugmalari va savatcha
function categoryKeyboard() {
  const buttons = categories.map(c => [c.sticker + ' ' + c.key]);
  buttons.push(['🛒 Savatcha']);
  return Markup.keyboard(buttons).resize();
}

// Bo‘lim tanlash
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text === '🛒 Savatcha') return showCart(ctx);

  const selected = categories.find(c => text.includes(c.key));
  if (!selected) return;

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('category', selected.key);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`${selected.sticker} *${selected.key} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 2 }));
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

// Savatcha ko‘rsatish
async function showCart(ctx) {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  cartItems.forEach(item => {
    text += `📦 ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Buyurtmani tasdiqlash va chek chiqarish', 'confirm_order')
  ]));
}

// Buyurtmani tasdiqlash va PDF
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user.latitude || !user.longitude) {
    ctx.reply('Iltimos, lokatsiyangizni yuboring.', Markup.keyboard([Markup.button.locationRequest('Lokatsiyani yuborish')]).oneTime().resize());
    return;
  }

  // Savatchani olamiz
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh!');

  // PDF yaratish
  const doc = new PDFDocument();
  const filePath = path.join('check_' + userId + '.pdf');
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(18).text('🛒 Buyurtma Cheki\n\n');

  cartItems.forEach((item, i) => {
    doc.fontSize(14).text(`${i+1}. ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m`);
  });

  doc.text(`\nLokatsiya: https://www.google.com/maps?q=${user.latitude},${user.longitude}`);
  doc.end();

  // Foydalanuvchidan so‘raymiz
  ctx.reply('Chek chiqarilsinmi?', Markup.inlineKeyboard([
    Markup.button.callback('Ha, chiqarsin', `pdf_yes_${userId}`),
    Markup.button.callback('Yo‘q', 'pdf_no')
  ]));
});

// PDF tasdiqlash
bot.action(/pdf_yes_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  const filePath = 'check_' + userId + '.pdf';
  ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename: 'check.pdf' });
  ctx.answerCbQuery();
});

// Lokatsiya qabul qilish
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// Adminga buyurtmalarni ko‘rsatish
bot.command('orders', async (ctx) => {
  if (ctx.from.id != adminId) return;

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

// Botni ishga tushirish
bot.launch();
console.log('Bot ishga tushdi 🚀');
