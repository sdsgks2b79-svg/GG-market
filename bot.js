import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Supabase ulanish
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Bo‘limlar
const categories = ['Mevalar', 'Sabzavotlar', 'Sut mahsulotlari', 'Kolbasalar', 'Ichimliklar', 'Shirinliklar'];

// Admin ID
const ADMIN_ID = 123456789; // o‘zingizning telegram ID

// --- START ---
bot.start(async (ctx) => {
  ctx.reply(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz.\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// --- CONTACT ---
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// --- BO‘LIM KLAVIATURASI ---
function categoryKeyboard() {
  return Markup.keyboard(categories.map(c => [c])).resize();
}

// --- BO‘LIM TANLASH ---
bot.hears(categories, async (ctx) => {
  const category = ctx.message.text;
  const { data: products } = await supabase.from('products').select('*').eq('category', category);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// --- MAHSULOT SAVATGA ---
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  await supabase.from('cart').upsert({
    user_id: userId,
    product_id: productId,
    quantity: 1
  }, { onConflict: ['user_id', 'product_id'] });

  ctx.answerCbQuery('Savatga qo‘shildi ✅');
});

// --- SAVATCHA ---
bot.command('cart', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, product:products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  cartItems.forEach((item, i) => {
    text += `${i+1}. ${item.product.name} — ${item.quantity} x ${item.product.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Chek chiqarilsinmi?', 'pdf_check')
  ]));
});

// --- CHEK PDF ---
bot.action('pdf_check', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select('quantity, product:products(name, price)')
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savat bo‘sh ❌');

  const doc = new PDFDocument();
  const filePath = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(filePath));

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

  ctx.replyWithDocument({ source: fs.createReadStream(filePath) });

  // Adminga xabar
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  bot.telegram.sendMessage(ADMIN_ID, `Yangi buyurtma:\n👤 ${ctx.from.first_name}\n📞 ${user.phone}\n🌍 Lokatsiya: https://www.google.com/maps?q=${user.latitude},${user.longitude}`);
});

// --- Lokatsiya ---
bot.on('location', async (ctx) => {
  const userId = ctx.from.id;
  const { latitude, longitude } = ctx.message.location;
  await supabase.from('users').upsert({ id: userId, latitude, longitude });
  ctx.reply('Lokatsiya qabul qilindi ✅');
});

// --- Qidiruv ---
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

// --- Botni ishga tushirish ---
bot.launch();
console.log('Bot ishlamoqda 🚀');
