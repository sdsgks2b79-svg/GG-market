import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

// Bot va Supabase ulanish
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Bo‘limlar va stikerlar
const categories = [
  { name: 'Mevalar', sticker: '🍎' },
  { name: 'Sabzavotlar', sticker: '🥦' },
  { name: 'Sut mahsulotlari', sticker: '🧈' },
  { name: 'Kolbasalar', sticker: '🥩' },
  { name: 'Ichimliklar', sticker: '🥤' },
  { name: 'Shirinliklar', sticker: '🍫' }
];

// Start
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

// Bo‘lim tugmalari
function categoryKeyboard() {
  return Markup.keyboard(categories.map(c => [`${c.sticker} ${c.name}`])).resize();
}

// Bo‘lim tanlash
bot.hears(categories.map(c => `${c.sticker} ${c.name}`), async (ctx) => {
  const text = ctx.message.text;
  const category = text.split(' ').slice(1).join(' '); // stickerdan ajratib olamiz
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
  const productId = parseInt(ctx.match[1]);
  const userId = ctx.from.id;

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

// Buyurtma tasdiqlash va PDF chek
bot.action('confirm_order', async (ctx) => {
  const userId = ctx.from.id;

  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user.latitude || !user.longitude) {
    ctx.reply('Iltimos, lokatsiyangizni yuboring.', Markup.keyboard([Markup.button.locationRequest('Lokatsiyani yuborish')]).oneTime().resize());
    return;
  }

  const { data: cartItems } = await supabase.from('cart')
    .select(`
      quantity,
      products(name, price)
    `)
    .eq('user_id', userId);

  if (!cartItems.length) return ctx.reply('Savat bo‘sh ❌');

  ctx.reply('Buyurtma tasdiqlansinmi? (PDF chek chiqariladi)', Markup.inlineKeyboard([
    Markup.button.callback('Ha', 'generate_pdf'),
    Markup.button.callback('Yo‘q', 'cancel_pdf')
  ]));
});

// PDF chek yaratish
bot.action('generate_pdf', async (ctx) => {
  const userId = ctx.from.id;
  const { data: cartItems } = await supabase.from('cart')
    .select(`
      quantity,
      products(name, price)
    `)
    .eq('user_id', userId);

  const doc = new PDFDocument();
  const stream = new PassThrough();

  ctx.replyWithDocument({ source: stream, filename: 'check.pdf' });
  doc.pipe(stream);

  doc.fontSize(18).text('📄 Sizning buyurtmangiz:', { underline: true });
  doc.moveDown();

  let total = 0;
  cartItems.forEach((item, i) => {
    const sum = item.quantity * item.products.price;
    total += sum;
    doc.fontSize(14).text(`${i+1}. ${item.products.name} — ${item.quantity} x ${item.products.price} so‘m = ${sum} so‘m`);
  });

  doc.moveDown();
  doc.fontSize(16).text(`Jami: ${total} so‘m`);
  doc.end();
});

// Buyurtmani bekor qilish
bot.action('cancel_pdf', async (ctx) => {
  ctx.reply('Buyurtma bekor qilindi ❌');
});

// Lokatsiyani qabul qilish
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
    ctx2.reply(`Natijalar:`, Markup.inlineKeyboard(buttons, { columns: 1 }));
  });
});

// Botni ishga tushirish
bot.launch();
console.log('Bot ishlamoqda 🚀');
