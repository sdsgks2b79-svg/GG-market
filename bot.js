import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import OpenAI from 'openai';

// --- Config ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ADMIN_ID = 8235655604;

// --- Categories & Sticker --- 
const categories = ['Mevalar 🍎', 'Sabzavotlar 🥕', 'Sut mahsulotlari 🥛', 'Kolbasalar 🥩', 'Ichimliklar 🥤', 'Shirinliklar 🍫'];

// --- /start ---
bot.start(async (ctx) => {
  ctx.reply(
    `Assalomu alaykum hurmatli mijoz! 🛒\nXush kelibsiz! Iltimos, telefon raqamingizni yuboring:`,
    Markup.keyboard([Markup.button.contactRequest('Telefonni yuborish')]).oneTime().resize()
  );
});

// --- Phone ---
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  await supabase.from('users').upsert({ id: userId, phone });
  ctx.reply('Telefon qabul qilindi ✅. Bo‘limlardan birini tanlang:', categoryKeyboard());
});

// --- Bo‘lim tugmalari ---
function categoryKeyboard() {
  const buttons = categories.map(c => [c]);
  buttons.push(['🛒 Savatcha', '🤖 AI Maslahat']);
  return Markup.keyboard(buttons).resize();
}

// --- Bo‘lim tanlash ---
bot.hears(categories, async (ctx) => {
  const category = ctx.message.text.replace(/ 🍎| 🥕| 🥛| 🥩| 🥤| 🍫/g, '');
  const { data: products } = await supabase.from('products').select('*').eq('category', category);

  if (!products.length) return ctx.reply('Bu bo‘limda mahsulot yo‘q 😔');

  const buttons = products.map(p => Markup.button.callback(`${p.name} — ${p.price} so‘m/kg`, `add_${p.id}`));
  ctx.reply(`📦 *${category} bo‘limi*:`, Markup.inlineKeyboard(buttons, { columns: 2 }));
});

// --- Mahsulotni savatga qo‘shish ---
bot.action(/add_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  const userId = ctx.from.id;

  // Foydalanuvchiga so‘raymiz: kg yoki so‘m
  await ctx.reply('Mahsulotni qanday olasiz?\n1️⃣ KG bo‘yicha\n2️⃣ Summa bo‘yicha', Markup.inlineKeyboard([
    Markup.button.callback('KG', `addkg_${productId}`),
    Markup.button.callback('Summa', `addsum_${productId}`)
  ]));
});

// --- KG yoki Summa tanlash ---
bot.action(/addkg_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  ctx.reply('Necha kilogram olasiz? (Masalan: 0.5, 1, 2)');
  bot.on('text', async (ctx2) => {
    const quantity = parseFloat(ctx2.message.text);
    if (isNaN(quantity)) return ctx2.reply('Iltimos, raqam kiriting!');
    const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
    await supabase.from('cart').upsert({ user_id: ctx2.from.id, product_id: productId, quantity }, { onConflict: ['user_id', 'product_id'] });
    ctx2.reply(`${product.name} savatga qo‘shildi ✅`);
  });
});

bot.action(/addsum_(\d+)/, async (ctx) => {
  const productId = ctx.match[1];
  ctx.reply('Necha so‘mlik olasiz? (Masalan: 5000, 10000)');
  bot.on('text', async (ctx2) => {
    const money = parseFloat(ctx2.message.text);
    if (isNaN(money)) return ctx2.reply('Iltimos, raqam kiriting!');
    const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
    const quantity = money / product.price;
    await supabase.from('cart').upsert({ user_id: ctx2.from.id, product_id: productId, quantity }, { onConflict: ['user_id', 'product_id'] });
    ctx2.reply(`${product.name} savatga qo‘shildi ✅ (≈${quantity.toFixed(2)} kg)`);
  });
});

// --- Savatcha ---
bot.hears('🛒 Savatcha', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart').select(`quantity, products(name, price)`).eq('user_id', userId);

  if (!cartItems || cartItems.length === 0) return ctx.reply('Savatcha bo‘sh 🛒');

  let text = "🛍 *Sizning savatchangiz:*\n\n";
  let total = 0;
  cartItems.forEach(item => {
    const price = item.quantity * item.products.price;
    total += price;
    text += `📦 ${item.products.name} — ${item.quantity.toFixed(2)} kg x ${item.products.price} so‘m = ${price.toFixed(0)} so‘m\n`;
  });
  text += `\n💰 *Jami*: ${total.toFixed(0)} so‘m`;

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('Buyurtmani tasdiqlash', 'confirm_order')
  ]));
});

// --- Buyurtmani tasdiqlash va PDF ---
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  const { data: cartItems } = await supabase.from('cart').select(`quantity, products(name, price)`).eq('user_id', userId);
  if (!cartItems || cartItems.length === 0) return ctx.reply('Savatcha bo‘sh 🛒');

  // PDF yaratish
  const doc = new PDFDocument();
  const filePath = `check_${userId}.pdf`;
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(16).text(`GG Market - Buyurtma Cheki\n\n`);
  let total = 0;
  cartItems.forEach(item => {
    const price = item.quantity * item.products.price;
    total += price;
    doc.fontSize(14).text(`${item.products.name} — ${item.quantity.toFixed(2)} kg x ${item.products.price} = ${price.toFixed(0)} so‘m`);
  });
  doc.fontSize(16).text(`\nJami: ${total.toFixed(0)} so‘m`);
  doc.end();

  ctx.reply('Buyurtmangiz qabul qilindi ✅ PDF chek tayyor.');
  // Adminga jo‘natish
  await bot.telegram.sendDocument(ADMIN_ID, { source: filePath });

  // Savatchani tozalash
  await supabase.from('cart').delete().eq('user_id', userId);
});

// --- AI Maslahat ---
bot.hears('🤖 AI Maslahat', async (ctx) => {
  ctx.reply('Savolingizni yozing, men AI orqali javob beraman:');
  bot.on('text', async (ctx2) => {
    const question = ctx2.message.text;
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: question }]
    });
    ctx2.reply(response.choices[0].message.content);
  });
});

// --- Start bot ---
bot.launch();
console.log('Bot ishlamoqda 🚀');
