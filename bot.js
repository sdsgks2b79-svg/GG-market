const { Telegraf } = require('telegraf');
const supabase = require('./database.js');
const products = require('./demoProducts.js'); // demo mahsulotlar, keyin Supabase'dan olamiz

const bot = new Telegraf(process.env.BOT_TOKEN);

// /start komandasi
bot.start(async (ctx) => {
    ctx.reply('Assalomu alaykum! Oziq-ovqat do‘koniga xush kelibsiz.');
});

// /products komandasi
bot.command('products', async (ctx) => {
    const { data, error } = await supabase.from('products').select('*');
    if (error) return ctx.reply('Xatolik yuz berdi.');

    if (data.length === 0) return ctx.reply('Mahsulotlar mavjud emas.');

    data.forEach(p => {
        ctx.replyWithPhoto(p.image, {
            caption: `${p.name}\nNarxi: ${p.price} $\nSifati: ${p.quality}`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Savatchaga qo‘shish', callback_data: `add_${p.id}` }]
                ]
            }
        });
    });
});

// 🔹 Mahsulotni savatchaga qo‘shish
bot.action(/add_(\d+)/, async (ctx) => {
    const productId = ctx.match[1];
    await supabase.from('cart').insert({
        user_id: ctx.from.id,
        product_id: productId,
        quantity: 1
    });
    ctx.answerCbQuery('Mahsulot savatchaga qo‘shildi ✅');
});

// /cart komandasi – foydalanuvchi savatchasini ko‘rsatadi
bot.command('cart', async (ctx) => {
    const { data, error } = await supabase
        .from('cart')
        .select('id, product_id, quantity, products(name, price)')
        .eq('user_id', ctx.from.id)
        .order('id', { ascending: true });
    
    if (error) return ctx.reply('Xatolik yuz berdi.');
    if (data.length === 0) return ctx.reply('Savatchangiz bo‘sh.');

    let message = 'Sizning savatchangiz:\n\n';
    data.forEach(item => {
        message += `${item.products.name} - ${item.quantity} ta - ${item.products.price}$\n`;
    });
    message += '\nBuyurtma berish uchun /checkout yozing';
    ctx.reply(message);
});

// /checkout komandasi – buyurtma berish va manzil so‘rash
bot.command('checkout', async (ctx) => {
    const { data } = await supabase.from('cart').select('*').eq('user_id', ctx.from.id);
    if (data.length === 0) return ctx.reply('Savatchangiz bo‘sh.');

    ctx.reply('Iltimos, manzilingizni yuboring', {
        reply_markup: {
            keyboard: [[{ text: 'Send Location', request_location: true }]],
            one_time_keyboard: true
        }
    });
});

// Foydalanuvchi location yuborsa
bot.on('location', async (ctx) => {
    const location = ctx.message.location;

    // Savatchadagi barcha mahsulotlar buyurtmaga aylanadi
    const { data: cartItems } = await supabase.from('cart').select('*').eq('user_id', ctx.from.id);
    for (const item of cartItems) {
        await supabase.from('orders').insert({
            user_id: ctx.from.id,
            product_id: item.product_id,
            quantity: item.quantity,
            status: 'pending',
            address: `${location.latitude},${location.longitude}`
        });
    }

    // Savatchani tozalash
    await supabase.from('cart').delete().eq('user_id', ctx.from.id);

    ctx.reply('Buyurtmangiz qabul qilindi ✅. Tez orada yetkazib beriladi.');
});

// Botni ishga tushirish
bot.launch().then(() => console.log('Bot ishlayapti ✅'));
