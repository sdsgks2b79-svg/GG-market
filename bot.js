import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Supabase ulanish
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Admin Telegram ID
const ADMIN_ID = 8235655604;

// Bo‘limlar va stikerlar
const categories = [
  { name: 'Mevalar', emoji: '🍎' },
  { name: 'Sabzavotlar', emoji: '🥦' },
  { name: 'Sut mahsulotlari', emoji: '🥛' },
  { name: 'Kolbasalar', emoji: '🌭' },
  { name: 'Ichimliklar', emoji: '🥤' },
  { name: 'Shirinliklar', emoji: '🍰' }
];

// =====================
// START
// =====================
bot.start(async (ctx) => {
  ctx.reply(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz GG Market botiga.\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// =====================
// Telefonni qabul qilish
// =====================
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// Bo‘limlar tugmalari
function categoryKeyboard() {
  return Markup.keyboard(categories.map(c => [c.emoji + ' ' + c.name])).resize();
}

// =====================
// Bo‘lim tanlash
// =====================
bot.hears(categories.map(c => c.emoji + ' ' + c.name), async (ctx) => {
  const text = ctx.message.text;
  const category = text.split(' ').slice(1).join(' ');
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('category', category);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// =====================
// Mahsulotni savatga qo‘shish
// =====================
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

// =====================
// Savatchani ko‘rsatish va chek
// =====================
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
    Markup.button.callback('Chek chiqarilsinmi?', 'make_pdf')
  ]));
});

// =====================
// PDF chek generatsiyasi
// =====================
bot.action('make_pdf', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select(`
      quantity,
      products(name, price)
    `)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savat bo‘sh!');

  const doc = new PDFDocument();
  const filePath = path.join('./', `check_${userId}.pdf`);
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(20).text('GG Market Chek', { align: 'center' });
  doc.moveDown();
  let total = 0;
  cartItems.forEach(item => {
    doc.fontSize(14).text(`${item.products.name} — ${item.quantity} x ${item.products.price} so‘m`);
    total += item.quantity * item.products.price;
  });
  doc.moveDown();
  doc.text(`Jami: ${total} so‘m`, { align: 'right' });
  doc.end();

  doc.on('finish', () => {
    ctx.replyWithDocument({ source: filePath, filename: `check_${userId}.pdf` });
  });
});

// =====================
// Lokatsiya qabul qilish
// =====================
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// =====================
// Real-time admin xabarlari
// =====================
const subscription = supabase
  .from('cart')
  .on('INSERT', payload => {
    const order = payload.new;
    (async () => {
      const { data: user } = await supabase.from('users').select('*').eq('id', order.user_id).single();
      const { data: product } = await supabase.from('products').select('*').eq('id', order.product_id).single();

      const text = `📦 Yangi buyurtma:\n${product.name} — ${order.quantity} x ${product.price} so‘m\nTelefon: ${user.phone}\nLokatsiya: https://www.google.com/maps?q=${user.latitude},${user.longitude}`;

      bot.telegram.sendMessage(ADMIN_ID, text);
    })();
  })
  .subscribe();

// =====================
// Bot ishga tushishi
// =====================
bot.launch();
console.log('Bot ishlamoqda 🚀');
