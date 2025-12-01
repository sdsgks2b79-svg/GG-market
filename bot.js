import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import OpenAI from 'openai';

// --- Bot va Supabase ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// --- Admin ---
const ADMIN_ID = 8235655604;

// --- Kategoriya bo‘limlari (emoji bilan) ---
const categories = [
  { name: 'Mevalar', emoji: '🍎' },
  { name: 'Sabzavotlar', emoji: '🥕' },
  { name: 'Sut mahsulotlari', emoji: '🥛' },
  { name: 'Kolbasalar', emoji: '🥩' },
  { name: 'Ichimliklar', emoji: '🥤' },
  { name: 'Shirinliklar', emoji: '🍬' },
];

// --- Start komandasi ---
bot.start((ctx) => {
  ctx.reply(
    `Assalomu alaykum hurmatli mijoz! 👋\nXush kelibsiz!\nIltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// --- Telefon qabul qilish ---
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// --- Kategoriya tugmalari ---
function categoryKeyboard() {
  return Markup.inlineKeyboard(
    categories.map(c => Markup.button.callback(`${c.emoji} ${c.name}`, `cat_${c.name}`)),
    { columns: 2 }
  );
}

// --- Kategoriya tanlash ---
bot.action(/cat_(.+)/, async (ctx) => {
  const category = ctx.match[1];
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

  await supabase.from('cart').upsert(
    { user_id: userId, product_id: productId, quantity: 1 },
    { onConflict: ['user_id', 'product_id'] }
  );

  ctx.answerCbQuery('Savatga qo‘shildi ✅');
});

// --- Savatcha ko‘rish ---
bot.command('cart', async (ctx) => {
  const userId = ctx.from.id;
  const { data: items } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!items.length) return ctx.reply('🛒 Savatcha bo‘sh!');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  items.forEach(i => {
    text += `📦 ${i.products.name} — ${i.quantity} x ${i.products.price} so‘m\n`;
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Chek chiqarilsinmi?', 'generate_pdf')
  ]));
});

// --- PDF chek yaratish ---
bot.action('generate_pdf', async (ctx) => {
  const userId = ctx.from.id;
  const { data: items } = await supabase.from('cart')
    .select('quantity, products(name, price)')
    .eq('user_id', userId);

  if (!items.length) return ctx.reply('Savat bo‘sh!');

  const doc = new PDFDocument();
  const fileName = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(fileName));

  doc.fontSize(16).text('🛒 Sizning chek:', { underline: true });
  let total = 0;
  items.forEach(i => {
    const price = i.quantity * i.products.price;
    total += price;
    doc.text(`${i.products.name} — ${i.quantity} x ${i.products.price} so‘m = ${price} so‘m`);
  });
  doc.text(`\nUmumiy: ${total} so‘m`);
  doc.end();

  // Foydalanuvchiga yuborish
  ctx.replyWithDocument({ source: fs.createReadStream(fileName), filename: fileName });

  // Adminga xabar
  ctx.telegram.sendMessage(
    ADMIN_ID,
    `Yangi buyurtma ✅\nUser ID: ${userId}\nUmumiy summa: ${total} so‘m`
  );

  // Savatni tozalash
  await supabase.from('cart').delete().eq('user_id', userId);
});

// --- AI maslahat tugmasi ---
bot.command('ai', (ctx) => ctx.reply('Savolingizni yozing, men AI orqali javob beraman:'));

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  // AI javob
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: ctx.message.text }]
  });

  ctx.reply(response.choices[0].message.content);
});

// --- Bot ishga tushirish ---
bot.launch();
console.log('Bot ishlamoqda 🚀');
