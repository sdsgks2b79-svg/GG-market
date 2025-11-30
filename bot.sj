import { Telegraf } from 'telegraf'
import { createClient } from '@supabase/supabase-js'

const bot = new Telegraf(process.env.8457032858:AAGloYCKOyk6-iuj18LbWqd1DbM_BQZ7nB0)

// Supabase ulanish
const supabase = createClient(
  process.env.https://vgtktugqrzcxyfgwpejn.supabase.co,
  process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZndGt0dWdxcnpjeHlmZ3dwZWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1MjE4MjUsImV4cCI6MjA4MDA5NzgyNX0.cRhBQleSApj4ld1cAWJBpCNV6UfhBgxKiZdDIjyYNgU
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
