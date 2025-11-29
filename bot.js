const { Telegraf } = require('telegraf');
const supabase = require('./database.js');
const products = require('./demoProducts.js');

const bot = new Telegraf(process.env.BOT_TOKEN);

// /start komandasi
bot.start(async (ctx) => {
    ctx.reply('Assalomu alaykum! Oziq-ovqat do‘koniga xush kelibsiz.');

    // Demo mahsulotlarni Supabase DB ga qo‘shish (faqat test uchun)
    for (const p of products) {
        await supabase
            .from('products')
            .upsert({
                name: p.name,
                price: p.price,
                quality: p.quality,
                image: p.image
            }, { onConflict: 'name' });
    }

    ctx.reply('Mahsulotlar bazaga yuklandi.');
});

// /products komandasi
bot.command('products', async (ctx) => {
    const { data, error } = await supabase.from('products').select('*');
    if (error) return ctx.reply('Xatolik yuz berdi.');
    
    if (data.length === 0) return ctx.reply('Mahsulotlar mavjud emas.');

    data.forEach(p => {
        ctx.replyWithPhoto(p.image, { caption: `${p.name}\nNarxi: ${p.price} $\nSifati: ${p.quality}` });
    });
});

bot.launch();
