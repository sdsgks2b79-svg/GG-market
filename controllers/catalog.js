import Product from "../models/Product.js";
import Cart from "../models/Cart.js";

export async function sendCategoryProducts(bot, chatId, category) {
  const items = await Product.find({ category });
  if (!items.length) return bot.sendMessage(chatId, "Bu kategoriyada mahsulot yo‘q.");
  items.forEach(item => {
    bot.sendPhoto(chatId, item.imageUrl, {
      caption: `${item.name}\nNarxi: ${item.price} so‘m\nSifati: ${item.quality}`,
      reply_markup: {
        inline_keyboard: [[{ text: "🛒 Savatga qo‘shish", callback_data: `add_${item._id}` }]]
      }
    });
  });
}

export async function addToCart(chatId, productId, bot) {
  const product = await Product.findById(productId);
  let cart = await Cart.findOne({ chatId });
  if (!cart) cart = new Cart({ chatId, items: [] });
  const item = cart.items.find(i => i.productId === productId);
  if (item) item.quantity += 1;
  else cart.items.push({ productId, name: product.name, price: product.price, quantity: 1 });
  await cart.save();
  bot.sendMessage(chatId, `🛒 ${product.name} savatga qo‘shildi!`);
}

export async function showCart(chatId, bot) {
  const cart = await Cart.findOne({ chatId });
  if (!cart || cart.items.length === 0) return bot.sendMessage(chatId, "🧺 Savat bo‘sh.");
  let text = "🧺 *Savat*\n\n";
  let total = 0;
  cart.items.forEach((item, idx) => { text += `${idx+1}. ${item.name} — ${item.quantity} dona — ${item.price*item.quantity} so‘m\n`; total += item.price*item.quantity; });
  text += `\n💰 *Umumiy:* ${total} so‘m`;
  bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🗑 Savatni tozalash", callback_data: "clear_cart" }], [{ text: "📦 Buyurtma berish", callback_data: "order_start" }]] } });
}

export async function clearCart(chatId, bot) {
  await Cart.deleteOne({ chatId });
  bot.sendMessage(chatId, "🧺 Savat tozalandi!");
}
