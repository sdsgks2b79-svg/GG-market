import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import OpenAI from 'openai';

// ----------------------------
// Environment Variables
// ----------------------------
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const adminId = 8235655604;

// ----------------------------
// Bo‘limlar
// ----------------------------
const categories = [
  { name: 'Mevalar', color: '🍎' },
  { name: 'Sabzavotlar', color: '🥕' },
  { name: 'Sut mahsulotlari', color: '🥛' },
  { name: 'Kolbasalar', color: '🥩' },
  { name: 'Ichimliklar', color: '🥤' },
  { name: 'Shirinliklar', color: '🍫' }
];

// ----------------------------
// /start komandasi
// ----------------------------
bot.start(async (ctx) => {
  ctx.reply(`Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz!`,
    Markup.keyboard([
      ['📂 Bo‘limlar', '🛒 Savatcha'],
      ['💡 AI Maslahat']
    ]).resize()
  );
});

// ----------------------------
// Bo‘limlar tugmasi
// ----------------------------
bot.hears('📂 Bo‘limlar', async (ctx) => {
  const buttons = categories.map(c => [Markup.button.callback(`${c.color} ${c.name}`, `category_${c.name}`)]);
  ctx.reply('Bo‘limlardan birini tanlang:', Markup.inlineKeyboard(buttons, { columns: 2 }));
});

// ----------------------------
// Mahsulotlarni ko‘rsatish
// ----------------------------
bot.action(/category_(.+)/, async (ctx) => {
  const category = ctx.match[1];
  const { data: products } = await supabase.from('products').select('*').eq('category', category);
  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m`, `add_${p.id}`));
  ctx.reply(`${category} bo‘limi:`, Markup.inlineKeyboard(buttons, { columns: 2 }));
});

// ----------------------------
// Mahsulotni savatchaga qo‘shish
// ----------------------------
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  ctx.reply('Iltimos, miqdorni kiriting (kg/dona yoki so‘mlik, masalan: 0.3 kg yoki 2 dona yoki 5000 so‘mlik):');

  bot.on('text', async (ctx2) => {
    const input = ctx2.message.text;
    let quantity = 1;
    let priceOverride = null;

    if (input.includes('so‘mlik')) {
      const match = input.match(/(\d+)/);
      if (match) priceOverride = parseInt(match[1]);
    } else {
      const match = input.match(/([\d.]+)/);
      if (match) quantity = parseFloat(match[1]);
    }

    const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
    const price = priceOverride || product.price * quantity;

    await supabase.from('cart').upsert({
      user_id: ctx2.from.id,
      product_id: productId,
      quantity,
      price
    }, { onConflict: ['user_id','product_id'] });

    ctx2.reply(`✅ Savatchaga qo‘shildi: ${product.name} — ${quantity} x ${product.price} so‘m (yakuniy: ${price} so‘m)`);
  });
});

// ----------------------------
// Savatchani ko‘rsatish
// ----------------------------
bot.hears('🛒 Savatcha', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart').select('quantity, price, products(name)').eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh 🛒');

  let text = "🛒 Sizning savatchangiz:\n\n";
  let total = 0;

  cartItems.forEach(item => {
    text += `${item.products.name} — ${item.quantity} x ${item.price} so‘m\n`;
    total += item.price;
  });

  text += `\nJami: ${total} so‘m`;

  ctx.reply(text, Markup.inlineKeyboard([
    Markup.button.callback('📄 Chek chiqarish', 'generate_check'),
    Markup.button.callback('✅ Buyurtmani tasdiqlash', 'confirm_order')
  ]));
});

// ----------------------------
// Chek PDF chiqarish
// ----------------------------
bot.action('generate_check', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart').select('quantity, price, products(name)').eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh, chek chiqarib bo‘lmaydi ❌');

  const doc = new PDFDocument();
  const fileName = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(fileName));

  doc.fontSize(20).text('✅ Sizning chek', { align: 'center' });
  let total = 0;
  cartItems.forEach(item => {
    doc.fontSize(14).text(`${item.products.name} — ${item.quantity} x ${item.price} so‘m`);
    total += item.price;
  });
  doc.text(`\nJami: ${total} so‘m`);
  doc.end();

  ctx.replyWithDocument({ source: fs.createReadStream(fileName), filename: fileName });
});

// ----------------------------
// Buyurtmani tasdiqlash
// ----------------------------
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart').select('quantity, price, products(name)').eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savatcha bo‘sh ❌');

  // Adminga xabar
  let message = `📦 Yangi buyurtma:\n`;
  let total = 0;
  cartItems.forEach(item => {
    message += `${item.products.name} — ${item.quantity} x ${item.price} so‘m\n`;
    total += item.price;
  });
  message += `\nJami: ${total} so‘m`;

  bot.telegram.sendMessage(adminId, message);

  // Savatchani tozalash
  await supabase.from('cart').delete().eq('user_id', userId);
  ctx.reply('✅ Buyurtma qabul qilindi! Adminga yuborildi.');
});

// ----------------------------
// Sun’iy intellekt tugmasi
// ----------------------------
bot.hears('💡 AI Maslahat', async (ctx) => {
  ctx.reply('Savolingizni yozing, men AI orqali javob beraman:');
  bot.on('text', async (ctx2) => {
    const prompt = ctx2.message.text;
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }]
    });
    ctx2.reply(response.choices[0].message.content);
  });
});

// ----------------------------
// Botni ishga tushirish
// ----------------------------
bot.launch();
console.log('Bot ishlamoqda 🚀');
