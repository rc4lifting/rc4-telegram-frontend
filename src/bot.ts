import { Telegraf, Context, Markup } from "telegraf";
import { session } from "telegraf";
import dotenv from "dotenv";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { components, operations } from "../schema/schema.d";
import { Calendar } from "telegram-inline-calendar";

dotenv.config();

const bot = new Telegraf<SessionContext>(process.env.BOT_TOKEN || "");
bot.use(session());
const API_BASE_URL = process.env.API_BASE_URL || "http://54.255.252.24:8000";

const calendar = new Calendar(bot, {
  date_format: "YYYY-MM-DD HH:mm", // Ensure the format includes time
  language: "en",
  bot_api: "telegraf",
  time_selector_mod: true, // Enable time selection
  time_range: "08:00-20:00", // Example time range
  time_step: "30m", // Example time step
  start_date: "now", // Set the minimum selectable date to the current date
});

interface SessionData {
  booking?: Partial<components["schemas"]["CreateBookingRequest"]>;
}

interface SessionContext extends Context {
  session: SessionData;
}

async function apiRequest<T extends keyof operations>(
  operationId: T,
  path: string,
  ctx: SessionContext,
  data?: any,
  params?: any
): Promise<any> {
  const url = `${API_BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    AccessToken: process.env.BOT_TOKEN || "",
    TelegramId: "229325521",
    TelegramUsername: "seidnichtmeshugge",
  };

  const methodMap: { [key: string]: string } = {
    get_venues_telegram_venue__get: "GET",
    add_booking_telegram_booking__post: "POST",
    get_bookings_telegram_booking__get: "GET",
    get_user_profile_telegram_user_userProfile_get: "GET",
    delete_booking_telegram_booking_deleteBooking_delete: "DELETE",
  };

  const method = methodMap[operationId] || "GET";

  const config: AxiosRequestConfig = {
    method,
    url,
    data,
    params,
    headers,
  };

  console.log("Sending request:", JSON.stringify(config, null, 2));

  try {
    const response = await axios(config);
    console.log(
      "Response received:",
      response.status,
      JSON.stringify(response.data, null, 2)
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(`API Request Error: ${axiosError.message}`);
      console.error(`Request URL: ${url}`);
      console.error(`Request Method: ${method}`);
      console.error(`Request Headers:`, JSON.stringify(headers, null, 2));
      console.error(`Response Status: ${axiosError.response?.status}`);
      console.error(
        `Response Data: ${JSON.stringify(axiosError.response?.data)}`
      );
    } else {
      console.error(`Non-Axios Error: ${error}`);
    }
    throw error;
  }
}

// Start command
bot.start((ctx) =>
  ctx.reply(
    "🎉 Welcome to the RC4 Booking Bot! Type /help for available commands."
  )
);

// Help command
bot.help((ctx) =>
  ctx.reply(
    "*Available commands:*\n\n" +
      "🏢 /venues - List available venues\n" +
      "📅 /book - Make a new booking\n" +
      "🗓 /mybookings - View your bookings\n" +
      "👤 /profile - View your profile\n" +
      "📊 /allbookings - View all bookings\n" +
      "🔍 /getbooking <id> - Get a specific booking\n" +
      "🗑 /deletebooking <id> - Delete a specific booking\n" +
      "🏢 /allvenues - List all venues\n" +
      "🔎 /getvenue <id> - Get a specific venue",
    { parse_mode: "Markdown" }
  )
);

function getVenueEmoji(venueName: string): string {
  const emojiMap: { [key: string]: string } = {
    SR1: "🏫",
    SR2: "🏫",
    SR3: "🏫",
    SR4: "🏫",
    SR5: "🏫",
    TR1: "🎨",
    TR2: "🎨",
    TR3: "🎨",
    TR4: "🎨",
    Gym: "🏋️",
    MPSH: "🏀",
  };

  return emojiMap[venueName] || "🏢";
}

// Venues command
bot.command("venues", async (ctx) => {
  console.log("venues command called");
  try {
    const response = await apiRequest(
      "get_venues_telegram_venue__get",
      "/telegram/venue/",
      ctx
    );
    const venues = response.items as components["schemas"]["Venue"][];
    const venueList = venues
      .map(
        (venue) => `${getVenueEmoji(venue.name)} *${venue.name}*: ${venue.desc}`
      )
      .join("\n");
    ctx.reply(`*Available venues:*\n\n${venueList}`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

// Book command
bot.command("book", async (ctx) => {
  console.log("book command called");
  try {
    const response = await apiRequest(
      "get_venues_telegram_venue__get",
      "/telegram/venue/",
      ctx
    );
    const venues = response.items as components["schemas"]["Venue"][];
    const keyboard = venues.map((venue) => [
      Markup.button.callback(venue.name, `book_venue_${venue.id}`),
    ]);
    ctx.reply("📅 Select a venue to book:", Markup.inlineKeyboard(keyboard));
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

// Booking flow
bot.action(/^book_venue_(\d+)$/, async (ctx) => {
  console.log("Book venue action triggered");
  if (!ctx.session) {
    ctx.session = {};
  }
  const match = ctx.match;
  if (match && match[1]) {
    const venueId = parseInt(match[1]);
    ctx.session.booking = { venue_id: venueId };
    await ctx.answerCbQuery();
    await calendar.startNavCalendar(ctx);
  } else {
    await ctx.answerCbQuery("Invalid venue selection");
    await ctx.reply("Please try booking again with a valid venue.");
  }
});

bot.on("callback_query", async (ctx) => {
  const message = ctx.callbackQuery?.message;
  const chatId = message?.chat?.id;

  if (
    !message ||
    !chatId ||
    message.message_id !== calendar.chats.get(chatId)
  ) {
    console.log("Callback query does not match calendar message");
    return;
  }

  const res = await calendar.clickButtonCalendar(ctx);
  console.log("Calendar button clicked, result:", res);

  if (res === -1) {
    console.log("Invalid calendar button click result:", res);
    return;
  }

  if (!ctx.session.booking) {
    ctx.session.booking = {};
  }

  if (!ctx.session.booking.start_time) {
    ctx.session.booking.start_time = res.toString();
    console.log("Start time set:", ctx.session.booking.start_time);
    await ctx.reply("🕕 Please select the end time:");

    console.log(`Start time selected: ${ctx.session.booking.start_time}`);
    const currentDate = new Date(ctx.session.booking.start_time)
      .toISOString()
      .split("T")[0];
    await calendar.startNavCalendar(ctx);
  } else {
    ctx.session.booking.end_time = res.toString();
    console.log("End time set:", ctx.session.booking.end_time);
    await createBooking(ctx);
  }
});

async function createBooking(ctx: SessionContext) {
  if (ctx.session && ctx.session.booking) {
    try {
      const bookingData: components["schemas"]["CreateBookingRequest"] = {
        ...(ctx.session
          .booking as components["schemas"]["CreateBookingRequest"]),
        users: [ctx.from?.username || ""],
        desc: "Gym booking", // Set default description
      };

      // Fetch the venue name based on the venue_id
      const venueResponse = await apiRequest(
        "get_venues_telegram_venue__get",
        "/telegram/venue/",
        ctx
      );
      const venues = venueResponse.items as components["schemas"]["Venue"][];
      const venue = venues.find((v) => v.id === bookingData.venue_id);
      const venueName = venue ? venue.name : "Unknown";

      await apiRequest(
        "add_booking_telegram_booking__post",
        "/telegram/booking/",
        ctx,
        bookingData
      );
      ctx.reply(
        `✅ Booking created successfully!\n\n🔖 *Booking Summary:*\n🏢 *Venue:* ${venueName}\n📝 *Description:* ${
          bookingData.desc
        }\n🕒 *Start:* ${bookingData.start_time}\n🕕 *End:* ${
          bookingData.end_time
        }\n👤 *User:* ${ctx.from?.username || "Unknown"}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      ctx.reply("Error creating booking. Please try again later.");
    }
    delete ctx.session.booking;
  } else {
    ctx.reply(
      "No booking in progress. Please start a new booking with /book command."
    );
  }
}

// My bookings command
bot.command("mybookings", async (ctx) => {
  console.log("mybookings command called");

  try {
    const response = (await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx,
      null,
      {
        page: 1,
        size: 50,
      }
    )) as components["schemas"]["Page_GetBookingRequest_"];

    console.log("All bookings:", JSON.stringify(response, null, 2));

    if (response.items.length === 0) {
      ctx.reply("You have no bookings.");
    } else {
      const bookingList = response.items
        .map((booking) => {
          return `🔖 *Booking ID:* ${booking.created_at}\n🏢 *Venue:* ${booking.venue_id}\n📝 *Description:* ${booking.desc}\n🕒 *Start:* ${booking.start_time}\n🕕 *End:* ${booking.end_time}`;
        })
        .join("\n\n");
      ctx.reply(`*Your bookings:*\n\n${bookingList}`, {
        parse_mode: "Markdown",
      });
    }
  } catch (error) {
    console.error("Error in mybookings command:", error);
    ctx.reply("Error fetching your bookings. Please try again later.");
  }
});

// Test command
bot.command("test", async (ctx) => {
  try {
    // Perform a simple API request to check connectivity
    await apiRequest(
      "get_user_profile_telegram_user_userProfile_get",
      "/telegram/user/userProfile",
      ctx
    );
    ctx.reply("✅ Test successful! Bot is connected and working properly.");
  } catch (error) {
    console.error("Test command error:", error);
    ctx.reply(
      "Test failed. There might be an issue with the bot or API connection."
    );
  }
});

// Profile command
bot.command("profile", async (ctx) => {
  try {
    const profile = await apiRequest(
      "get_user_profile_telegram_user_userProfile_get",
      "/telegram/user/userProfile",
      ctx
    );
    ctx.reply(
      `👤 *Your profile:*\n📛 *Name:* ${profile.name}\n🆔 *NUS Net ID:* ${
        profile.nus_net_id
      }\n🚪 *Room:* ${profile.room_number}\n🎭 *Roles:* ${profile.roles.join(
        ", "
      )}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    ctx.reply("Error fetching your profile. Please try again later.");
  }
});

// Get all bookings
bot.command("allbookings", async (ctx) => {
  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx
    );
    const bookings =
      response.items as components["schemas"]["GetBookingRequest"][];
    if (bookings.length === 0) {
      ctx.reply("There are no bookings.");
    } else {
      const bookingList = bookings
        .map(
          (booking) =>
            `🏢 *Venue:* ${booking.venue_id}\n📝 *Description:* ${booking.desc}\n🕒 *Start:* ${booking.start_time}\n🕕 *End:* ${booking.end_time}`
        )
        .join("\n\n");
      ctx.reply(`*All bookings:*\n\n${bookingList}`, {
        parse_mode: "Markdown",
      });
    }
  } catch (error) {
    ctx.reply("Error fetching bookings. Please try again later.");
  }
});

// Get booking by ID
bot.command("getbooking", async (ctx) => {
  const bookingId = ctx.message.text.split(" ")[1];
  if (!bookingId) {
    return ctx.reply("Please provide a booking ID. Usage: /getbooking <id>");
  }
  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      `/telegram/booking/`,
      ctx,
      null,
      { bookingId: bookingId }
    );
    const booking = response.items.find(
      (b: any) => b.id === parseInt(bookingId)
    );
    if (booking) {
      ctx.reply(
        `🔖 *Booking details:*\n🏢 *Venue:* ${booking.venue_id}\n📝 *Description:* ${booking.desc}\n🕒 *Start:* ${booking.start_time}\n🕕 *End:* ${booking.end_time}`,
        { parse_mode: "Markdown" }
      );
    } else {
      ctx.reply("Booking not found.");
    }
  } catch (error) {
    ctx.reply("Error fetching booking. Please check the ID and try again.");
  }
});

// Delete booking
bot.command("deletebooking", async (ctx) => {
  const bookingId = ctx.message.text.split(" ")[1];
  if (!bookingId) {
    return ctx.reply("Please provide a booking ID. Usage: /deletebooking <id>");
  }
  try {
    await apiRequest(
      "delete_booking_telegram_booking_deleteBooking_delete",
      `/telegram/booking/deleteBooking`,
      ctx,
      null,
      { bookingId: bookingId }
    );
    ctx.reply("🗑 Booking deleted successfully.");
  } catch (error) {
    ctx.reply("Error deleting booking. Please check the ID and try again.");
  }
});

// Get all venues
bot.command("allvenues", async (ctx) => {
  try {
    const response = await apiRequest(
      "get_venues_telegram_venue__get",
      "/telegram/venue/",
      ctx
    );
    const venues = response.items as components["schemas"]["Venue"][];
    const venueList = venues
      .map(
        (venue) => `${getVenueEmoji(venue.name)} *${venue.name}*: ${venue.desc}`
      )
      .join("\n");
    ctx.reply(`*All venues:*\n\n${venueList}`, { parse_mode: "Markdown" });
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

// Get venue by ID
bot.command("getvenue", async (ctx) => {
  const venueId = ctx.message.text.split(" ")[1];
  if (!venueId) {
    return ctx.reply("Please provide a venue ID. Usage: /getvenue <id>");
  }
  try {
    const response = await apiRequest(
      "get_venues_telegram_venue__get",
      `/telegram/venue/`,
      ctx,
      null,
      { venueId: venueId }
    );
    const venue = response.items.find((v: any) => v.id === parseInt(venueId));
    if (venue) {
      ctx.reply(
        `${getVenueEmoji(venue.name)} *Venue details:*\n📛 *Name:* ${
          venue.name
        }\n📝 *Description:* ${venue.desc}`,
        { parse_mode: "Markdown" }
      );
    } else {
      ctx.reply("Venue not found.");
    }
  } catch (error) {
    ctx.reply("Error fetching venue. Please check the ID and try again.");
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply("An error occurred. Please try again later.");
  throw err; // Re-throw the error after handling
});

// Launch bot
bot.launch().catch((err) => {
  console.error("Error launching bot:", err);
  process.exit(1);
});

bot.on("text", (ctx) => {
  console.log("Text message received:", ctx.message.text);
  console.log("Current session state:", JSON.stringify(ctx.session, null, 2));
  if (ctx.session && ctx.session.booking) {
    if (!ctx.session.booking.desc) {
      ctx.session.booking.desc = ctx.message.text;
      ctx.reply("🕒 Please enter the start time (YYYY-MM-DD HH:MM):");
    } else if (!ctx.session.booking.start_time) {
      ctx.session.booking.start_time = ctx.message.text;
      ctx.reply("🕕 Please enter the end time (YYYY-MM-DD HH:MM):");
    } else if (!ctx.session.booking.end_time) {
      ctx.session.booking.end_time = ctx.message.text;
      createBooking(ctx);
    }
  }
});
// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
