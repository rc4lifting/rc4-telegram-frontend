import { Telegraf, Context, Markup } from "telegraf";
import { session } from "telegraf";
import dotenv from "dotenv";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { components, operations } from "../schema/schema.d";

dotenv.config();

const bot = new Telegraf<SessionContext>(process.env.BOT_TOKEN || "");
bot.use(session());
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
    await ctx.reply("📝 Please enter the booking description:");
  } else {
    await ctx.answerCbQuery("Invalid venue selection");
    await ctx.reply("Please try booking again with a valid venue.");
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
      ctx.reply("✅ Booking created successfully!");
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

  // Set this to true to use mock data, false to use real API
  const useMockData = true;

  try {
    let bookings;
    let venues;

    if (useMockData) {
      // Mock venue data
      venues = [
        { id: 1, name: "SR1", desc: "Seminar Room 1" },
        { id: 2, name: "SR2", desc: "Seminar Room 2" },
        { id: 3, name: "SR3", desc: "Seminar Room 3" },
        { id: 4, name: "SR4", desc: "Seminar Room 4" },
        { id: 5, name: "SR5", desc: "Seminar Room 5" },
        { id: 6, name: "TR1", desc: "Theme Room 1" },
        { id: 7, name: "TR2", desc: "Theme Room 2" },
        { id: 8, name: "TR3", desc: "Theme Room 3" },
        { id: 9, name: "TR4", desc: "Theme Room 4" },
        { id: 10, name: "Gym", desc: "Gym" },
        { id: 11, name: "MPSH", desc: "Multi-purpose sports hall" },
      ];

      // Mock bookings data
      bookings = [
        {
          id: 1,
          venue_id: 1,
          desc: "Team meeting",
          start_time: "2023-05-01 10:00:00",
          end_time: "2023-05-01 12:00:00",
        },
        {
          id: 2,
          venue_id: 3,
          desc: "Study group",
          start_time: "2023-05-02 14:00:00",
          end_time: "2023-05-02 16:00:00",
        },
        {
          id: 3,
          venue_id: 10,
          desc: "Workout session",
          start_time: "2023-05-03 18:00:00",
          end_time: "2023-05-03 19:30:00",
        },
      ];
    } else {
      // Real API calls
      const venuesResponse = await apiRequest(
        "get_venues_telegram_venue__get",
        "/telegram/venue/",
        ctx
      );
      venues = venuesResponse.items as components["schemas"]["Venue"][];

      const bookingsResponse = await apiRequest(
        "get_bookings_telegram_booking__get",
        "/telegram/booking/",
        ctx
      );
      bookings =
        bookingsResponse.items as components["schemas"]["GetBookingRequest"][];
    }

    if (bookings.length === 0) {
      ctx.reply("You have no bookings.");
    } else {
      const bookingList = bookings
        .map((booking) => {
          const venue = venues.find((v) => v.id === booking.venue_id);
          const venueName = venue ? venue.name : "Unknown";
          return `🔖 *Booking ID:* ${booking.venue_id}\n${getVenueEmoji(
            venueName
          )} *Venue:* ${venueName}\n📝 *Description:* ${
            booking.desc
          }\n🕒 *Start:* ${booking.start_time}\n🕕 *End:* ${booking.end_time}`;
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
      ctx.reply(
        "👥 Please enter the usernames of other participants (comma-separated):"
      );
    } else {
      ctx.session.booking.users = ctx.message.text
        .split(",")
        .map((u) => u.trim());
      createBooking(ctx);
    }
  }
});
// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
