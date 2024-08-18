import { Telegraf, Context, Markup } from "telegraf";
import { session } from "telegraf";
import dotenv from "dotenv";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { components, operations } from "../schema/schema.d";

dotenv.config();

const bot = new Telegraf<SessionContext>(process.env.BOT_TOKEN || "");
const API_BASE_URL = process.env.API_BASE_URL || "http://54.255.252.24:8000";

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
    TelegramId: ctx.from?.id.toString() || "",
    TelegramUsername: ctx.from?.username || "",
  };

  // Map the operationId to the correct HTTP method
  const methodMap: { [key: string]: string } = {
    get_venues_telegram_venue__get: "GET",
    add_booking_telegram_booking__post: "POST",
    get_bookings_telegram_booking__get: "GET",
    get_user_profile_telegram_user_userProfile_get: "GET",
    // Add other mappings as needed
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
    "Welcome to the RC4 Booking Bot! Type /help for available commands."
  )
);

// Help command
bot.help((ctx) =>
  ctx.reply(
    "Available commands:\n" +
      "/venues - List available venues\n" +
      "/book - Make a new booking\n" +
      "/mybookings - View your bookings\n" +
      "/profile - View your profile"
  )
);

// Venues command
bot.command("venues", async (ctx) => {
  try {
    const response = await apiRequest(
      "get_venues_telegram_venue__get",
      "/telegram/venue/",
      ctx
    );
    const venues = response.items as components["schemas"]["Venue"][];
    const venueList = venues
      .map((venue) => `${venue.name}: ${venue.desc}`)
      .join("\n");
    ctx.reply(`Available venues:\n${venueList}`);
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

// Book command
bot.command("book", async (ctx) => {
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
    ctx.reply("Select a venue to book:", Markup.inlineKeyboard(keyboard));
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

// Booking flow
bot.action(/^book_venue_(\d+)$/, async (ctx) => {
  const match = ctx.match;
  if (match && match[1]) {
    const venueId = parseInt(match[1]);
    ctx.session.booking = { venue_id: venueId };
    await ctx.answerCbQuery();
    await ctx.reply("Please enter the booking description:");
  } else {
    await ctx.answerCbQuery("Invalid venue selection");
    await ctx.reply("Please try booking again with a valid venue.");
  }
});

bot.on("text", (ctx) => {
  // log something here
  if (ctx.session && ctx.session.booking) {
    if (!ctx.session.booking.desc) {
      ctx.session.booking.desc = ctx.message.text;
      ctx.reply("Please enter the start time (YYYY-MM-DD HH:MM):");
    } else if (!ctx.session.booking.start_time) {
      ctx.session.booking.start_time = ctx.message.text;
      ctx.reply("Please enter the end time (YYYY-MM-DD HH:MM):");
    } else if (!ctx.session.booking.end_time) {
      ctx.session.booking.end_time = ctx.message.text;
      ctx.reply(
        "Please enter the usernames of other participants (comma-separated):"
      );
    } else {
      ctx.session.booking.users = ctx.message.text
        .split(",")
        .map((u) => u.trim());
      createBooking(ctx);
    }
  }
});

async function createBooking(ctx: SessionContext) {
  if (ctx.session && ctx.session.booking) {
    try {
      const bookingData: components["schemas"]["CreateBookingRequest"] = {
        ...(ctx.session
          .booking as components["schemas"]["CreateBookingRequest"]),
        users: [
          ...(ctx.session.booking?.users || []),
          ctx.from?.username || "",
        ],
      };
      await apiRequest(
        "add_booking_telegram_booking__post",
        "/telegram/booking/",
        ctx,
        bookingData
      );
      ctx.reply("Booking created successfully!");
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
  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx
    );
    const bookings =
      response.items as components["schemas"]["GetBookingRequest"][];
    if (bookings.length === 0) {
      ctx.reply("You have no bookings.");
    } else {
      const bookingList = bookings
        .map(
          (booking) =>
            `Venue: ${booking.venue_id}\nDescription: ${booking.desc}\nStart: ${booking.start_time}\nEnd: ${booking.end_time}`
        )
        .join("\n\n");
      ctx.reply(`Your bookings:\n${bookingList}`);
    }
  } catch (error) {
    ctx.reply("Error fetching your bookings. Please try again later.");
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
      `Your profile:\nName: ${profile.name}\nNUS Net ID: ${
        profile.nus_net_id
      }\nRoom: ${profile.room_number}\nRoles: ${profile.roles.join(", ")}`
    );
  } catch (error) {
    ctx.reply("Error fetching your profile. Please try again later.");
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

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
