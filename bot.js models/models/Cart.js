import mongoose from "mongoose";

const cartSchema = new mongoose.Schema({
  chatId: Number,
  items: [
    { productId: String, name: String, price: Number, quantity: Number }
  ]
});

export default mongoose.model("Cart", cartSchema);
