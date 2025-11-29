import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Cart from "./models/Cart.js";
import { demoProducts } from "./demoProducts.js";
import { sendCategoryProducts, addToCart, showCart, clearCart } from "./controllers/catalog.js";

dotenv.config();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminId = process.env.ADMIN_CHAT_ID;

// MongoDB ulash
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB ulandi");
    const count = await Product.countDocuments();
    if (count === 0) {
      await Product.insertMany(demoProducts);
      console.log("Demo mahsulotlar qo‘shildi");
    }
  })
  .catch(err => console.log(err));

// Start / menu
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === "/start") {
    bot.sendMessage(chatId, "🍏 Oziq-ovqat do‘koniga xush kelibsiz!", {
      reply_markup: {
        keyboard: [
          ["🛒 Mahsulotlar", "🧺 Savat"],
          ["📦 Buyurtma berish", "ℹ️ Yordam"]
        ],
        resize_keyboard: true
      }
    });
  }
  if (msg.text === "🛒 Mahsulotlar") {
    bot.sendMessage(chatId, "Kategoriya tanlang:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🥛 Sut mahsulotlari", callback_data: "cat_milk" }],
          [{ text: "🥖 Non & Qandolat", callback_data: "cat_bakery" }],
          [{ text: "🍗 Go‘sht", callback_data: "cat_meat" }],
          [{ text: "🍎 Meva & Sabzavot", callback_data: "cat_fruit" }],
          [{ text: "🥤 Ichimliklar", callback_data: "cat_drinks" }]
        ]
      }
    });
  }
  if (msg.text === "🧺 Savat") showCart(chatId, bot);
});

// Callback query
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data.startsWith("cat_")) {
    const category = query.data.replace("cat_", "");
    sendCategoryProducts(bot, chatId, category);
  }

  if (query.data.startsWith("add_")) {
    const productId = query.data.replace("add_", "");
    addToCart(chatId, productId, bot);
  }

  if (query.data === "clear_cart") clearCart(chatId, bot);

  if (query.data === "order_start") {
    bot.sendMessage(chatId, "📞 Telefon raqamingizni yuboring:", {
      reply_markup: { keyboard: [[{ text: "Raqam yuborish", request_contact: true }]], resize_keyboard: true }
    });
  }
});

// Kontakt qabul qilish
bot.on("contact", (msg) => {
  const chatId = msg.chat.id;
  const phone = msg.contact.phone_number;
  bot.sendMessage(chatId, "🏠 Manzilingizni kiriting:");
  bot.on("message", (msg2) => {
    if (msg2.contact) return;
    const address = msg2.text;
    bot.sendMessage(chatId, "✅ Buyurtmangiz qabul qilindi!\nTez orada yetkazib beriladi.");
    bot.sendMessage(adminId, `📦 Yangi buyurtma\nTelefon: ${phone}\nManzil: ${address}`);
  });
});
