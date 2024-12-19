import { Telegraf, Context } from "telegraf";
import { DateTime } from "luxon";
import { Credentials, FBSInteractor, SlotTakenException, InvalidBookingTimeException } from "./services/FBSInteractorService"; // Adjust path as needed
import credentials from '../credentials.json';

interface MySessionData {}

// Extend context if needed
interface MyContext extends Context {
  // Add session if needed, but here we don't rely heavily on session
}

const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN || "");

bot.start((ctx) => {
  ctx.reply("Hello! To book, send a message like: \n\n`book SR1 2024-12-25 10:00 to 2024-12-25 12:00`", { parse_mode: "Markdown" });
});

// A simple venue mapping. Adjust as per your actual venue setup.
const VENUE_MAP: Record<string, number> = {
  "SR1": 1,
  "SR2": 2,
  "SR3": 3,
  "SR4": 4,
  "SR5": 5,
  "TR1": 6,
  "TR2": 7,
  "TR3": 8,
  "TR4": 9,
  "Gym": 10,
  "MPSH": 11
};

// Add this after the VENUE_MAP definition
const AUTHORIZED_USERS = new Map(
  credentials.users.map(user => [user.telegram_id, {
    utownfbs_username: user.utownfbs_username,
    utownfbs_password: user.utownfbs_password
  }])
);

// Example usage type and user count
const USAGE_TYPE = "Student Activities"; 
const USER_COUNT = 2;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Singapore';

// Regex to parse the booking command
// Format: book VENUE YYYY-MM-DD HH:mm to YYYY-MM-DD HH:mm
const BOOKING_REGEX = /^book\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/i;

bot.on("text", async (ctx) => {
  // Check if user is authorized
  const userId = ctx.from?.id;
  if (!userId || !AUTHORIZED_USERS.has(userId)) {
    await ctx.reply("❌ You are not authorized to use this bot.");
    return;
  }

  const message = ctx.message.text.trim();
  const match = message.match(BOOKING_REGEX);
  if (!match) {
    await ctx.reply(
      "❌ Invalid format. Please use:\n" +
      "`book VENUE YYYY-MM-DD HH:mm to YYYY-MM-DD HH:mm`\n\n" +
      "Example:\n" +
      "`book SR1 2024-01-25 14:00 to 2024-01-25 16:00`\n\n" +
      "Available venues: SR1, SR2, SR3, SR4, SR5, TR1, TR2, TR3, TR4, Gym, MPSH", 
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Extract details from regex
  const [_, venueName, startDateStr, startTimeStr, endDateStr, endTimeStr] = match;

  // Check venue
  const venueId = VENUE_MAP[venueName];
  if (!venueId) {
    await ctx.reply(`❌ Unknown venue: ${venueName}. Please try again.`);
    return;
  }

  // Parse times
  const startDT = DateTime.fromFormat(`${startDateStr} ${startTimeStr}`, "yyyy-MM-dd HH:mm", { zone: TIMEZONE });
  const endDT = DateTime.fromFormat(`${endDateStr} ${endTimeStr}`, "yyyy-MM-dd HH:mm", { zone: TIMEZONE });
  const now = DateTime.now().setZone(TIMEZONE);

  if (!startDT.isValid || !endDT.isValid) {
    await ctx.reply("❌ Invalid date/time format. Please follow the `YYYY-MM-DD HH:mm` format.");
    return;
  }

  if (endDT <= startDT) {
    await ctx.reply("❌ End time must be after start time.");
    return;
  }

  if (endDT <= now) {
    await ctx.reply("❌ Booking must be in the future.");
    return;
  }

  await ctx.reply("Processing your booking request. Please wait...");

  const startStr = startDT.toFormat("yyyy-MM-dd HH:mm:ss");
  const endStr = endDT.toFormat("yyyy-MM-dd HH:mm:ss");
  
  const purpose = `Telegram booking by ${ctx.from?.username || "Unknown user"}`;
  const userCreds = AUTHORIZED_USERS.get(userId) as Credentials;

  try {
    const bookingRef = await FBSInteractor.bookSlot(
      startStr,
      endStr,
      purpose,
      venueId,
      USAGE_TYPE,
      USER_COUNT,
      userCreds
    );

    if (!bookingRef) {
      await ctx.reply("❌ Could not get booking reference. Please try again.");
      return;
    }

    // The screenshot is saved in FBSInteractor as shown previously
    // Adjust this if needed. Assuming it returns a known screenshot path or you modified bookSlot to return it.
    const screenshotPath = `booking-confirmation-${Date.now()}.png`;

    await ctx.replyWithPhoto({ source: screenshotPath }, {
      caption: `✅ Booking confirmed!\nReference: ${bookingRef}`,
    });
  } catch (error) {
    let errorMessage = "An error occurred during booking.";
    if (error instanceof SlotTakenException) {
      errorMessage = "❌ The selected slot is already taken. Please choose another time.";
    } else if (error instanceof InvalidBookingTimeException) {
      errorMessage = `❌ Invalid booking time: ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = `❌ ${error.message}`;
    }

    await ctx.reply(errorMessage);
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.launch().then(() => {
  console.log("Bot is running...");
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
