import { Telegraf } from 'telegraf'
import { createClient } from '@supabase/supabase-js'

const bot = new Telegraf(process.env.BOT_TOKEN)

// Supabase ulanish
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)
bot.start(async (ctx) => {
  const { data: products } = await supabase
    .from('products')
    .select('*')

  let text = "🛒 *Mahsulotlar ro'yxati:*\n\n"

  products.forEach((p) => {
    text += `📦 *${p.name}*\n💵 Narxi: ${p.price}\n\n`
  })

  ctx.replyWithMarkdown(text)
})
bot.command('cart', async (ctx) => {
  const { data: cartItems } = await supabase
    .from('cart')
    .select(`
      quantity,
      products(name, price)
    `)
    .eq('user_id', ctx.from.id)

  if (!cartItems.length)
    return ctx.reply("🛒 Savatcha bo'sh!")

  let text = "🛍 *Savatchangiz:*\n\n"

  cartItems.forEach((item) => {
    text += `📦 ${item.products.name} — ${item.quantity} x ${item.products.price}\n`
  })

  ctx.replyWithMarkdown(text)
})
