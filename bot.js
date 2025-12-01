// bot.js
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "200012560";

if (!BOT_TOKEN || !ADMIN_ID) throw new Error("BOT_TOKEN va ADMIN_ID Environment Variables da kerak");

const bot = new Telegraf(BOT_TOKEN);

// ---------- Mahsulotlar ----------
const CATEGORIES = [
  { name: "🍓 Mevalar", products: [
      { id: 1, name: "Kartoshka", price: 7000, unit: "kg" },
      { id: 2, name: "Sabzi", price: 6000, unit: "kg" }
  ]},
  { name: "🥛 Sut mahsulotlari", products: [
      { id: 3, name: "Yogurt (200g)", price: 8000, unit: "piece" },
      { id: 4, name: "Sut 1L", price: 9000, unit: "piece" }
  ]},
  { name: "🥤 Ichimliklar", products: [
      { id: 5, name: "Pepsi 1.5L", price: 12000, unit: "piece" },
      { id: 6, name: "Coca-Cola 1.5L", price: 12000, unit: "piece" }
  ]},
  { name: "🍖 Kolbasalar", products: [
      { id: 7, name: "Kolbasa", price: 50000, unit: "kg" }
  ]},
  { name: "🍫 Shirinliklar", products: [
      { id: 8, name: "Shokolad", price: 20000, unit: "kg" }
  ]},
  { name: "🍞 Boshqa", products: [
      { id: 9, name: "Non oddiy", price: 4000, unit: "piece" }
  ]}
];

// ---------- In-memory storage ----------
const carts = new Map();
const userState = new Map();
const userPhone = new Map();

// ---------- Helper functions ----------
function ensureCart(userId){ if(!carts.has(userId)) carts.set(userId, []); return carts.get(userId); }
function clearCart(userId){ carts.delete(userId); }
function findProductById(id){ return CATEGORIES.flatMap(c => c.products).find(p => p.id == id); }
function addOrReplaceInCart(userId, item){
    const cart = ensureCart(userId);
    const idx = cart.findIndex(ci => ci.productId === item.productId);
    if(idx>=0) cart[idx]=item;
    else cart.push(item);
}
function cartSummary(userId){
    const cart = ensureCart(userId);
    let total=0;
    const lines=cart.map(ci=>{
        total+=ci.price;
        if(ci.unitType==="piece") return `• ${ci.productName} — ${ci.quantity} dona × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
        if(ci.unitType==="kg") return `• ${ci.productName} — ${ci.quantity.toFixed(2)} kg × ${ci.unitPrice.toLocaleString()} = ${ci.price.toLocaleString()} so'm`;
        return `• ${ci.productName} — ${ci.price.toLocaleString()} so'm`;
    });
    return { lines, total };
}
function chunkButtons(arr, cols=2){
    const out=[];
    for(let i=0;i<arr.length;i+=cols) out.push(arr.slice(i,i+cols));
    return out;
}
function createPdf(userId, lines, total, phone){
    return new Promise((resolve,reject)=>{
        try{
            const filename=`check_${userId}_${Date.now()}.pdf`;
            const filepath=path.join("/tmp", filename);
            const doc=new PDFDocument({margin:30});
            const stream=fs.createWriteStream(filepath);
            doc.pipe(stream);
            doc.fontSize(18).text("GG Market — Buyurtma Cheki",{align:"center"});
            doc.moveDown();
            doc.fontSize(12).text(`Telefon: ${phone}`);
            doc.text(`Sana: ${new Date().toLocaleString()}`);
            doc.moveDown();
            lines.forEach(l=>doc.text(l));
            doc.moveDown();
            doc.fontSize(14).text(`Jami: ${total.toLocaleString()} so'm`,{align:"right"});
            doc.moveDown();
            doc.fontSize(12).text("Haridingiz uchun rahmat!");
            doc.end();
            stream.on("finish",()=>resolve(filepath));
            stream.on("error",reject);
        }catch(e){reject(e);}
    });
}

// ---------- Keyboards ----------
function mainMenuKeyboard(){
    return Markup.keyboard([["📂 Bo'limlar","🛒 Savatcha"],["/start"]]).resize();
}
function categoriesInlineKeyboard(){
    const buttons=[];
    CATEGORIES.forEach(cat=>{
        buttons.push([Markup.button.callback(cat.name, `cat_${cat.name}`)]);
    });
    buttons.push([Markup.button.callback("🛒 Savatcha","show_cart")]);
    return Markup.inlineKeyboard(buttons);
}
function productsKeyboard(cat){
    const buttons=cat.products.map(p=>Markup.button.callback(`${p.name} — ${p.price.toLocaleString()}${p.unit==="kg"?" so'm/kg":" so'm"}`,`add_${p.id}`));
    buttons.push(Markup.button.callback("🔙 Orqaga","back_to_cats"));
    return Markup.inlineKeyboard(chunkButtons(buttons,1));
}

// ---------- Bot Handlers ----------
bot.start(async ctx=>{
    if(!userPhone.has(ctx.from.id)){
        await ctx.reply("Assalomu alaykum! Iltimos, telefon raqamingizni yuboring.",Markup.keyboard([Markup.button.contactRequest("📲 Telefon raqam yuborish")]).resize());
    } else {
        await ctx.reply("Xush kelibsiz!",mainMenuKeyboard());
    }
});

bot.on("contact", async ctx=>{
    if(ctx.message.contact && ctx.message.contact.phone_number){
        userPhone.set(ctx.from.id, ctx.message.contact.phone_number);
        await ctx.reply(`Telefon raqamingiz saqlandi: ${ctx.message.contact.phone_number}`,mainMenuKeyboard());
    }
});

// Bo‘limlar
bot.hears("📂 Bo'limlar",async ctx=>{
    await ctx.reply("Bo'limlarni tanlang:",categoriesInlineKeyboard());
});

bot.action(/cat_(.+)/,async ctx=>{
    await ctx.answerCbQuery();
    const catName=ctx.match[1];
    const cat=CATEGORIES.find(c=>c.name===catName);
    if(!cat) return ctx.reply("Bo‘lim topilmadi.");
    await ctx.reply(`📦 ${cat.name}:`,productsKeyboard(cat));
});

bot.action(/add_(\d+)/,async ctx=>{
    await ctx.answerCbQuery();
    const pid=ctx.match[1];
    const product=findProductById(pid);
    if(!product) return ctx.reply("Mahsulot topilmadi.");
    if(product.unit==="piece"){
        userState.set(ctx.from.id,{mode:"await_count",productId:pid});
        return ctx.reply(`Nechta ${product.name} olasiz? (butun son)`);
    } else if(product.unit==="kg"){
        userState.set(ctx.from.id,{mode:"await_kg",productId:pid});
        return ctx.reply(`Necha kg ${product.name} olasiz? (masalan: 0.5,1)`);
    }
});

bot.on("text",async ctx=>{
    const userId=ctx.from.id;
    const text=(ctx.message.text||"").trim();
    if(userState.has(userId)){
        const state=userState.get(userId);
        const product=findProductById(state.productId);
        const number=parseFloat(text.replace(",","."));
        if(state.mode==="await_count"){
            const cnt=parseInt(text);
            if(isNaN(cnt)||cnt<=0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");
            const price=product.price*cnt;
            addOrReplaceInCart(userId,{productId:product.id,productName:product.name,unitType:"piece",unitPrice:product.price,quantity:cnt,price});
            userState.delete(userId);
            return ctx.reply(`${product.name} — ${cnt} dona savatchaga qo‘shildi ✅`);
        }
        if(state.mode==="await_kg"){
            if(isNaN(number)||number<=0) return ctx.reply("Iltimos to‘g‘ri son kiriting.");
            const qty=number;
            const price=Math.round(product.price*qty);
            addOrReplaceInCart(userId,{productId:product.id,productName:product.name,unitType:"kg",unitPrice:product.price,quantity:qty,price});
            userState.delete(userId);
            return ctx.reply(`${product.name} — ${qty} kg savatchaga qo‘shildi ✅`);
        }
    }
    if(text==="🛒 Savatcha"){
        const {lines,total}=cartSummary(userId);
        if(!lines.length) return ctx.reply("Savatcha bo‘sh!");
        return ctx.reply(lines.join("\n")+`\n\nJami: ${total.toLocaleString()} so'm`,Markup.inlineKeyboard([
            [Markup.button.callback("✅ Yakunlash","checkout")],
            [Markup.button.callback("🗑️ Tozalash","clear_cart")]
        ]));
    }
});

bot.action("clear_cart",async ctx=>{
    clearCart(ctx.from.id);
    await ctx.answerCbQuery();
    return ctx.reply("Savatcha tozalandi ✅");
});

bot.action("checkout",async ctx=>{
    const userId=ctx.from.id;
    const {lines,total}=cartSummary(userId);
    if(!lines.length) return ctx.reply("Savatcha bo‘sh!");
    const phone=userPhone.get(userId);
    if(!phone) return ctx.reply("Iltimos avval telefon raqamingizni yuboring.");

    await ctx.reply("Buyurtmani qanday olasiz?",Markup.inlineKeyboard([
        [Markup.button.callback("Yetkazib berish","delivery"),Markup.button.callback("Olib ketish","pickup")]
    ]));
    userState.set(userId,{mode:"await_delivery"});
});

bot.action("delivery",async ctx=>{
    await ctx.answerCbQuery();
    userState.set(ctx.from.id,{mode:"await_location"});
    await ctx.reply("Iltimos lokatsiyangizni yuboring.",Markup.keyboard([Markup.button.locationRequest("📍 Lokatsiya yuborish")]).resize());
});

bot.action("pickup",async ctx=>{
    await ctx.answerCbQuery();
    const {lines,total}=cartSummary(ctx.from.id);
    const phone=userPhone.get(ctx.from.id);
    const filepath=await createPdf(ctx.from.id,lines,total,phone);
    await ctx.reply(`Sizning buyurtmangiz tayyor! Do‘kon manzili: https://maps.app.goo.gl/UFp7BaPwaaPxbWhW9?g_st=ic`);
    await ctx.telegram.sendDocument(ADMIN_ID,{source:filepath});
    await ctx.replyWithDocument({source:filepath});
    clearCart(ctx.from.id);
    userState.delete(ctx.from.id);
    await ctx.reply("Haridingiz uchun rahmat! ❤️",mainMenuKeyboard());
});

bot.on("location",async ctx=>{
    if(!userState.has(ctx.from.id)) return;
    const state=userState.get(ctx.from.id);
    if(state.mode==="await_location"){
        const loc=ctx.message.location;
        await ctx.telegram.sendLocation(ADMIN_ID,loc.latitude,loc.longitude);
        const {lines,total}=cartSummary(ctx.from.id);
        const phone=userPhone.get(ctx.from.id);
        const filepath=await createPdf(ctx.from.id,lines,total,phone);
        await ctx.reply("Buyurtmangiz qabul qilindi! Adminga jo‘natildi.");
        await ctx.telegram.sendDocument(ADMIN_ID,{source:filepath});
        await ctx.replyWithDocument({source:filepath});
        clearCart(ctx.from.id);
        userState.delete(ctx.from.id);
        await ctx.reply("Haridingiz uchun rahmat! ❤️",mainMenuKeyboard());
    }
});

// Orqaga
bot.action("back_to_cats",async ctx=>{
    await ctx.answerCbQuery();
    await ctx.reply("Bo‘limlarni tanlang:",categoriesInlineKeyboard());
});

// Launch bot
bot.launch().then(()=>console.log("Bot ishga tushdi 🚀"));

process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
