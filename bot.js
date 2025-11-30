import { Telegraf, Markup } from 'telegraf'
import { createClient } from '@supabase/supabase-js'

// -------------------------
// Env fayldan olingan token va supabase
// -------------------------
const bot = new Telegraf(process.env.BOT_TOKEN)

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// -------------------------
// Bo'limlar
// -------------------------
const categories = [
  'Mevalar',
  'Ichimliklar',
  'Sut mahsulotlari',
  'Kolbasalar',
  'Tozalash vositalari',
  'Ichimliklar',
  'Konfet va shirinliklar'
]

// -------------------------
// Start
// -------------------------
bot.start(async (ctx) => {
  const userId = ctx.from.id
  await supabase.from('users').upsert({id: userId})
  await ctx.replyWithMarkdown(
    "Assalomu alaykum qadrli mijozlarimiz!\n\nBo'limlardan birini tanlang:",
    Markup.inlineKeyboard(
      categories.map(c => Markup.button.callback(c, `cat_${c}`))
    )
  )
})

// -------------------------
// Bo'limni tanlash
// -------------------------
bot.action(/cat_(.+)/, async (ctx) => {
  const category = ctx.match[1]

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('category', category)

  if (!products.length) return ctx.reply("Bu bo'limda mahsulot yo'q")

  await ctx.replyWithMarkdown(
    `🛒 *${category} bo'limi:*`,
    Markup.inlineKeyboard(
      products.map(p =>
        Markup.button.callback(`${p.name} - ${p.price} so'm`, `prod_${p.id}`)
      ),
      {columns: 1}
    )
  )
})

// -------------------------
// Mahsulotni savatga qo'shish
// -------------------------
bot.action(/prod_(\d+)/, async (ctx) => {
  const productId = ctx.match[1]
  const userId = ctx.from.id

  await ctx.answerCbQuery("Savatga qo‘shilmoqda...")

  const { error } = await supabase
    .from('cart')
    .upsert([
      { user_id: userId, product_id: productId, quantity: 1 }
    ], { onConflict: 'user_id,product_id' })

  if (error) return ctx.reply("Xatolik: " + error.message)
  await ctx.reply("🛒 Mahsulot savatchaga qo‘shildi!")
})

// -------------------------
// Savatchani ko'rsatish
// -------------------------
bot.command('cart', async (ctx) => {
  const userId = ctx.from.id

  const { data: cartItems, error } = await supabase
    .from('cart')
    .select(`
      quantity,
      product:product_id (name, price)
    `)
    .eq('user_id', userId)

  if (error) return ctx.reply("Xatolik: " + error.message)
  if (!cartItems.length) return ctx.reply("🛒 Savatcha bo'sh!")

  let text = "🛍 *Savatchangiz:*\n\n"
  let total = 0

  cartItems.forEach(item => {
    const subtotal = item.quantity * item.product.price
    total += subtotal
    text += `📦 ${item.product.name} — ${item.quantity} x ${item.product.price} so'm = ${subtotal} so'm\n`
  })

  text += `\n💰 *Umumiy summa:* ${total} so'm`

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    Markup.button.callback('✅ Tasdiqlash', `confirm_cart`)
  ]))
})

// -------------------------
// Savatchani tasdiqlash
// -------------------------
bot.action('confirm_cart', async (ctx) => {
  await ctx.replyWithMarkdown(
    "Mahsulotlar tasdiqlandi!\n\n📍 Yetkazib berish yoki olib ketish tanlang:",
    Markup.inlineKeyboard([
      Markup.button.locationRequest("📍 Lokatsiya yuborish"),
      Markup.button.callback("🏬 Olib ketish", "pickup")
    ])
  )
})

// -------------------------
// Lokatsiya qabul qilish
// -------------------------
bot.on('location', async (ctx) => {
  const userId = ctx.from.id
  const { latitude, longitude } = ctx.message.location
  await supabase.from('users').upsert({id: userId, latitude, longitude})
  await ctx.reply("📍 Lokatsiyangiz saqlandi! Tez orada yetkazib beriladi.")
})

// -------------------------
// Olib ketish
// -------------------------
bot.action('pickup', async (ctx) => {
  await ctx.reply("🏬 Mahsulotingiz do‘kondan olib ketish uchun tayyor.")
})

// -------------------------
// Bot ishga tushishi
// -------------------------
bot.launch()
console.log("Bot ishga tushdi ✅")
