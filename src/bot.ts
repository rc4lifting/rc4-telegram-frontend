import { Telegraf, Context } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || "");

bot.start((ctx) => ctx.reply("Welcome to your new Telegram bot!"));
bot.help((ctx) =>
  ctx.reply("Send me a message and I will echo it back to you.")
);

bot.on("message", (ctx: Context) => {
  if (ctx.message && "text" in ctx.message) {
    ctx.reply(`You said: ${ctx.message.text}`);
  } else {
    ctx.reply("I can only process text messages.");
  }
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
