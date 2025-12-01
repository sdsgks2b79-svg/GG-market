// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// --- CONFIG: environment variables ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "8235655604"; // string or number

if (!BOT_TOKEN) throw new Error("BOT_TOKEN not set in env");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY not set — AI features will fail");

// --- clients ---
const bot = new Telegraf(BOT_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- In-memory storage (simple, fast). If you need persistence, we'll switch to Supabase ---
// Map userId -> [{ productId, productName, unitType, quantity, price }]
const carts = new Map();

// --- Products (JSON). You can edit/add items here. "unit": "kg" | "piece" | "sum" (sum means price-fixed item entry type)
const PRODUCTS = [
  // Mevalar (kg)
  { id: 1, name: "Kartoshka", price: 7000, unit: "kg", category: "Mevalar" },
  { id: 2, name: "Sabzi", price: 6000, unit: "kg", category: "Mevalar" },
  // Sut mahsulotlari (piece)
  { id: 3, name: "Yogurt", price: 8000, unit: "piece", category: "Sut mahsulotlari" },
  { id: 4, name: "Sut 1L", price: 9000, unit: "piece", category: "Sut mahsulotlari" },
  // Ichimliklar (piece)
  { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  { id: 6, name: "Cola 1.5L", price: 12000, unit: "piece", category: "Ichimliklar" },
  // Kolbasalar (sum) — you can use "sum" if commonly sold by fixed package price
  { id: 7, name: "Kolbasa (paket)", price: 50000, unit: "piece", category: "Kolbasalar" },
  // Shirinliklar
  { id: 8, name: "Shokolad", price: 20000, unit: "kg", category: "Shirinliklar" },
  { id: 9, name: "Non", price: 4000, unit: "piece", category: "Sabzavotlar" }, // example
];

// --- categories derived from products (unique) ---
const CATEGORIES = [...new Set(PRODUCTS.map(p => p.category))];

// --- per-user state machine for awaiting numeric input etc. ---
const userState = new Map(); // userId -> { mode, productId, unitChoice } modes: 'await_count', 'await_kg', 'await_sum', null

// ---------------- helpers ----------------
function findProductById(id) {
  return PRODUCTS.find(p => Number(p.id) === Number(id));
}
function findProductByName(name) {
  const n = name.toLowerCase();
  return PRODUCTS.find(p => p.name.toLowerCase().includes(n));
}
function ensureCart(userId) {
  if (!carts.has(userId)) carts.set(userId, []);
  return carts.get(userId);
}
function addToCart(userId, item) {
  // item: { productId, productName, unitType, quantity, price }
  const cart = ensureCart(userId);
  // if same product exists -> replace (we treat it as last chosen quantity) or sum? We'll replace for clarity
  const existingIndex = cart.findIndex(ci => Number(ci.productId) === Number(item.productId));
  if (existingIndex >= 0) cart[existingIndex] = item;
  else cart.push(item);
}
function clearCart(userId) {
  carts.delete(userId);
}
function cartSummary(userId) {
  const cart = ensureCart(userId);
  let total = 0;
  const lines = cart.map(ci => {
    const price = Math.round(ci.price);
    total += price;
    if (ci.unitType === "piece") {
      return `• ${ci.productName} — ${ci.quantity} dona × ${ci.unitPrice} = ${price} so'm`;
    } else if (ci.unitType === "kg") {
      return `• ${ci.productName} — ${ci.quantity.toFixed(2)} kg × ${ci.unitPrice} = ${price} so'm`;
    } else if (ci.unitType === "sum") {
      return `• ${ci.productName} — ${price} so'm (pulga qarab)`;
    } else {
      return `• ${ci.productName} — ${ci.quantity} × ${ci.unitPrice} = ${price} so'm`;
    }
  });
  return { lines, total };
}
function generateCategoryKeyboard() {
  // inline keyboard two columns
  const buttons = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [];
    row.push(Markup.button.callback(CATEGORIES[i], `cat_${CATEGORIES[i]}`));
    if (CATEGORIES[i + 1]) row.push(Markup.button.callback(CATEGORIES[i + 1], `cat_${CATEGORIES[i + 1]}`));
    buttons.push(row);
  }
  // Last row: Cart and AI and /start
  buttons.push([
    Markup.button.callback("🛒 Savatcha", "show_cart"),
    Markup.button.callback("🤖 Suniy intelekt (AI)", "ai_mode"),
  ]);
  buttons.push([Markup.button.callback("/start", "start_cmd")]);
  return Markup.inlineKeyboard(buttons);
}

// write PDF promise (returns file path)
function createPdfForOrder(userId, orderLines, total) {
  return new Promise((resolve, reject) => {
    const fileName = `check_${userId}_${Date.now()}.pdf`;
    // use /tmp if exists (safer on Linux hosts like Render)
    const tmpDir = process.env.TMPDIR || "/tmp";
    const filePath = path.join(tmpDir, fileName);

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("GG Market — Buyurtma Cheki", { align: "center" });
    doc.moveDown();

    orderLines.forEach(line => {
      doc.fontSize(12).text(line);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Jami: ${total.toLocaleString("ru-RU")} so'm`, { align: "right" });

    doc.end();

    stream.on("finish", () => resolve(filePath));
    stream.on("error", (err) => reject(err));
  });
}

// Use OpenAI to parse natural language shopping commands into structured items
async function aiParseOrderText(text) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const prompt = `
You are a helpful parser. User sends a shopping request in Uzbek/Russian/English. Extract items into JSON array.
Return ONLY valid JSON array (no extra text). 
Each item object: { "name": "<product name guessed>", "quantity": <number>, "unit": "kg"|"piece"|"sum" }
Rules:
- If user says "0.5 kg", quantity = 0.5 and unit = "kg".
- If user says "2 dona", quantity = 2 and unit = "piece".
- If user says "5000 so'm" or "5000 som", set unit = "sum" and quantity equal to that money number.
If you cannot determine a quantity for an item, skip it.
Examples:
Input: "Menga 2ta pepsi va 0.5 kg kartoshka qo'sh"
Output: [{"name":"pepsi","quantity":2,"unit":"piece"},{"name":"kartoshka","quantity":0.5,"unit":"kg"}]
Now parse this input: ${JSON.stringify(text)}
  `;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });
  const content = res.choices?.[0]?.message?.
