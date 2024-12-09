import { Telegraf, Context, Markup } from "telegraf";
import { session } from "telegraf";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { components, operations } from "../schema/schema.d";

export type BookingStep = "start_date" | "start_time" | "end_date" | "end_time" | "confirm";

export interface SessionData {
  currentBooking?: {
    step: BookingStep;
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    startOffset?: number;
    endOffset?: number;
    venue_id?: number;
  };
  booking?: any;
}

export interface SessionContext extends Context {
  session: SessionData;
}

export interface CalendarBookingData {
  venue_id: number;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
}

export class BookingCalendar {
  bot: Telegraf<SessionContext>;
  dateRangeDays: number;
  maxWeeks: number;
  timeStepMinutes: number;
  startHour: number;
  endHour: number;
  private onBookingDataReady?: (bookingData: CalendarBookingData, ctx: SessionContext) => Promise<void>;

  constructor(
    bot: Telegraf<SessionContext>, 
    options?: {
      dateRangeDays?: number;
      maxWeeks?: number;
      timeStepMinutes?: number;
      startHour?: number;
      endHour?: number;
    },
    onBookingDataReady?: (bookingData: CalendarBookingData, ctx: SessionContext) => Promise<void>
  ) {
    this.bot = bot;
    this.dateRangeDays = options?.dateRangeDays || 7;
    this.maxWeeks = options?.maxWeeks || 2;
    this.timeStepMinutes = options?.timeStepMinutes || 30;
    this.startHour = options?.startHour || 8;
    this.endHour = options?.endHour || 20;
    this.onBookingDataReady = onBookingDataReady;
  }

  async startBookingFlow(ctx: SessionContext, venue_id: number) {
    ctx.session.currentBooking = {
      step: "start_date",
      startOffset: 0,
      endOffset: 0,
      venue_id: venue_id
    };
    
    const markup = this.buildDateKeyboard("start_date_", "start_nav_", 0);
    await ctx.reply("📅 Select a *start date*:", {
      parse_mode: "Markdown",
      reply_markup: markup
    });
  }

  async handleCallbackQuery(ctx: SessionContext) {
    const data = (ctx.callbackQuery as any).data;
    if (!data || !ctx.session.currentBooking) return;

    const state = ctx.session.currentBooking;

    // Navigation for start date
    if (data.startsWith("start_nav_")) {
      const offset = parseInt(data.replace("start_nav_", ""), 10);
      await ctx.answerCbQuery();
      state.startOffset = offset;
      await this.renderStartDateSelection(ctx, offset);
      return;
    }

    // Navigation for end date
    if (data.startsWith("end_nav_")) {
      const offset = parseInt(data.replace("end_nav_", ""), 10);
      await ctx.answerCbQuery();
      state.endOffset = offset;
      await this.renderEndDateSelection(ctx, offset);
      return;
    }

    // Cancel action
    if (data === "cancel_booking") {
      await ctx.answerCbQuery("Booking canceled");
      delete ctx.session.currentBooking;
      try {
        await ctx.editMessageText("Booking canceled.");
      } catch {
        await ctx.reply("Booking canceled.");
      }
      return;
    }

    switch (state.step) {
      case "start_date":
        if (data.startsWith("start_date_")) {
          const dateISO = data.replace("start_date_", "");
          await ctx.answerCbQuery(`Selected start date: ${this.formatDate(new Date(dateISO))}`);
          state.startDate = dateISO;
          state.step = "start_time";
          await this.renderStartTimeSelection(ctx, dateISO);
        }
        break;

      case "start_time":
        if (data.startsWith("start_time_")) {
          const startTime = data.replace("start_time_", "");
          await ctx.answerCbQuery(`Selected start time: ${startTime}`);
          state.startTime = startTime;
          state.step = "end_date";
          state.endOffset = 0;
          await this.renderEndDateSelection(ctx, 0);
        }
        break;

      case "end_date":
        if (data.startsWith("end_date_")) {
          const dateISO = data.replace("end_date_", "");
          await ctx.answerCbQuery(`Selected end date: ${this.formatDate(new Date(dateISO))}`);
          state.endDate = dateISO;
          state.step = "end_time";
          await this.renderEndTimeSelection(ctx, state.startDate!, state.startTime!, dateISO);
        }
        break;

      case "end_time":
        if (data.startsWith("end_time_")) {
          const endTime = data.replace("end_time_", "");
          await ctx.answerCbQuery(`Selected end time: ${endTime}`);
          state.endTime = endTime;
          state.step = "confirm";
          await this.renderConfirmation(ctx, state.startDate!, state.startTime!, state.endDate!, endTime);
        }
        break;

      case "confirm":
        if (data === "confirm_booking") {
          const { startDate, startTime, endDate, endTime, venue_id } = state;
          
          if (!startDate || !startTime || !endDate || !endTime || !venue_id) {
            await ctx.answerCbQuery("Missing booking information");
            return;
          }

          if (this.onBookingDataReady) {
            await this.onBookingDataReady({
              venue_id,
              start_date: startDate,
              start_time: startTime,
              end_date: endDate,
              end_time: endTime
            }, ctx);
          }
          return;
        }
        break;
    }
  }

  private async renderStartDateSelection(ctx: SessionContext, offset: number) {
    const markup = this.buildDateKeyboard("start_date_", "start_nav_", offset);
    await this.editOrSend(ctx, "📅 Select a *start date*:", markup);
  }

  private async renderStartTimeSelection(ctx: SessionContext, dateISO: string) {
    const date = new Date(dateISO);
    const now = new Date();
    const slots = this.generateTimeSlots(date, now, true);
    if (slots.length === 0) {
      try {
        await ctx.editMessageText("No available start times for the selected date. Please pick a different start date.");
      } catch {
        await ctx.reply("No available start times for the selected date. Please pick a different start date.");
      }
      ctx.session.currentBooking!.step = "start_date"; 
      return;
    }
    const buttons = slots.map(slot => Markup.button.callback(slot, `start_time_${slot}`));
    const markup = {
      inline_keyboard: [
        ...this.chunkButtons(buttons, 4),
        [Markup.button.callback("❌ Cancel", "cancel_booking")]
      ]
    };
    try {
      await ctx.editMessageText(
        `Start Date: ${this.formatDate(date)}\n\nSelect a *start time*:`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    } catch {
      await ctx.reply(
        `Start Date: ${this.formatDate(date)}\n\nSelect a *start time*:`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    }
  }

  private async renderEndDateSelection(ctx: SessionContext, offset: number) {
    const markup = this.buildDateKeyboard("end_date_", "end_nav_", offset);
    try {
      await ctx.editMessageText("Select an *end date*:", { parse_mode: "Markdown", reply_markup: markup });
    } catch {
      await ctx.reply("Select an *end date*:", { parse_mode: "Markdown", reply_markup: markup });
    }
  }

  private async renderEndTimeSelection(ctx: SessionContext, startDateISO: string, startTime: string, endDateISO: string) {
    const startDate = new Date(startDateISO);
    const endDate = new Date(endDateISO);

    const [startHour, startMin] = startTime.split(":").map(Number);
    const startDateTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startHour, startMin);

    const now = new Date();
    let slots: string[];
    if (this.isSameDay(startDate, endDate)) {
      slots = this.generateTimeSlots(endDate, now, false, startDateTime);
    } else {
      slots = this.generateTimeSlots(endDate, now, true);
    }

    if (slots.length === 0) {
      try {
        await ctx.editMessageText("No end times available for the selected date. Please pick a different end date.");
      } catch {
        await ctx.reply("No end times available for the selected date. Please pick a different end date.");
      }
      ctx.session.currentBooking!.step = "end_date"; 
      return;
    }

    const buttons = slots.map(slot => Markup.button.callback(slot, `end_time_${slot}`));
    const markup = {
      inline_keyboard: [
        ...this.chunkButtons(buttons, 4),
        [Markup.button.callback("❌ Cancel", "cancel_booking")]
      ]
    };

    try {
      await ctx.editMessageText(
        `Start: ${this.formatDateTime(startDateISO, startTime)}\nEnd Date: ${this.formatDate(endDate)}\n\nSelect an *end time*:`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    } catch {
      await ctx.reply(
        `Start: ${this.formatDateTime(startDateISO, startTime)}\nEnd Date: ${this.formatDate(endDate)}\n\nSelect an *end time*:`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    }
  }

  private async renderConfirmation(ctx: SessionContext, startDateISO: string, startTime: string, endDateISO: string, endTime: string) {
    const startStr = this.formatDateTime(startDateISO, startTime);
    const endStr = this.formatDateTime(endDateISO, endTime);
    const markup = {
      inline_keyboard: [
        [Markup.button.callback("✅ Confirm", "confirm_booking"), 
         Markup.button.callback("❌ Cancel", "cancel_booking")]
      ]
    };

    try {
      await ctx.editMessageText(
        `**Please confirm your booking:**\n\nStart: ${startStr}\nEnd: ${endStr}`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    } catch {
      await ctx.reply(
        `**Please confirm your booking:**\n\nStart: ${startStr}\nEnd: ${endStr}`,
        { parse_mode: "Markdown", reply_markup: markup }
      );
    }
  }

  private buildDateKeyboard(prefix: string, navPrefix: string, offset: number) {
    const now = new Date();
    now.setHours(0,0,0,0);
    const buttons: any[] = [];
    for (let i = 0; i < this.dateRangeDays; i++) {
      const day = new Date(now.getTime() + (i + offset * this.dateRangeDays) * 24*60*60*1000);
      const label = this.formatShortDate(day);
      buttons.push(Markup.button.callback(label, `${prefix}${day.toISOString()}`));
    }

    const navRow = [];
    if (offset > 0) {
      navRow.push(Markup.button.callback("⬅️ Prev Week", `${navPrefix}${offset-1}`));
    }
    if (offset < this.maxWeeks - 1) {
      navRow.push(Markup.button.callback("Next Week ➡️", `${navPrefix}${offset+1}`));
    }

    const keyboard = [
      ...this.chunkButtons(buttons, 4),
      navRow.length ? navRow : [],
      [Markup.button.callback("❌ Cancel", "cancel_booking")]
    ];

    return Markup.inlineKeyboard(keyboard).reply_markup;
  }

  private generateTimeSlots(date: Date, now: Date, isStartTime: boolean, startDateTime?: Date): string[] {
    const slots: string[] = [];
    for (let hour = this.startHour; hour <= this.endHour; hour++) {
      for (let min = 0; min < 60; min += this.timeStepMinutes) {
        const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, min);
        if (isStartTime) {
          if (slotDate > now) {
            slots.push(this.formatTime(slotDate));
          }
        } else {
          if (startDateTime && slotDate > startDateTime) {
            slots.push(this.formatTime(slotDate));
          } else if (!startDateTime && slotDate > now) {
            slots.push(this.formatTime(slotDate));
          }
        }
      }
    }
    return slots;
  }

  private async editOrSend(ctx: SessionContext, text: string, markup: any) {
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: markup });
        return;
      } catch (error) {
        // If editing fails, send a new message
      }
    }
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: markup });
  }

  private chunkButtons(buttons: any[], size: number): any[] {
    const result = [];
    for (let i = 0; i < buttons.length; i += size) {
      result.push(buttons.slice(i, i + size));
    }
    return result;
  }

  private formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', weekday: 'short', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  private formatShortDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  private formatTime(date: Date): string {
    const hour = String(date.getHours()).padStart(2,'0');
    const min = String(date.getMinutes()).padStart(2,'0');
    return `${hour}:${min}`;
  }

  private formatDateTime(dateISO: string, time: string): string {
    const date = new Date(dateISO);
    return `${this.formatDate(date)} ${time}`;
  }

  private isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }
}

// Create bot
const bot = new Telegraf<SessionContext>(Bun.env.BOT_TOKEN || "");
bot.use(session({
  defaultSession: () => ({ 
    currentBooking: undefined,
    booking: undefined
  })
}));
const API_BASE_URL = Bun.env.API_BASE_URL || "http://54.255.252.24:8000";

// Initialize calendar with validation and booking logic
const calendar = new BookingCalendar(
  bot,
  {
    dateRangeDays: 14,
    timeStepMinutes: 30,
    startHour: 8,
    endHour: 20
  },
  async (bookingData: CalendarBookingData, ctx: SessionContext) => {
    try {
      const startDateTime = new Date(`${bookingData.start_date}T${bookingData.start_time}`);
      const endDateTime = new Date(`${bookingData.end_date}T${bookingData.end_time}`);
      
      if (endDateTime <= startDateTime) {
        try {
          await ctx.editMessageText(
            "❌ End time must be after start time. Please try again.",
            { parse_mode: "Markdown" }
          );
        } catch {
          await ctx.reply(
            "❌ End time must be after start time. Please try again.",
            { parse_mode: "Markdown" }
          );
        }
        return;
      }

      const booking: components["schemas"]["CreateBookingRequest"] = {
        venue_id: bookingData.venue_id,
        start_time: `${bookingData.start_date.split('T')[0]} ${bookingData.start_time}:00`,
        end_time: `${bookingData.end_date.split('T')[0]} ${bookingData.end_time}:00`,
        users: ctx.from?.username ? [ctx.from.username] : [],
        desc: `Venue booking by ${ctx.from?.username || 'Unknown user'}`
      };

      console.log('Booking data:', {
        start_time: booking.start_time,
        end_time: booking.end_time
      });

      await apiRequest(
        "add_booking_telegram_booking__post",
        "/telegram/booking/",
        ctx,
        booking
      );

      // Get venue details
      const venueResponse = await apiRequest(
        "get_venues_telegram_venue__get",
        "/telegram/venue/",
        ctx
      );
      const venues = venueResponse.items as components["schemas"]["Venue"][];
      const venue = venues.find(v => v.id === booking.venue_id);
      const venueName = venue ? venue.name : "Unknown venue";

      try {
        await ctx.editMessageText(
          `✅ Booking created successfully!\n\n` +
          `🔖 *Booking Summary:*\n` +
          `🏢 *Venue:* ${venueName}\n` +
          `📝 *Description:* ${booking.desc}\n` +
          `🕒 *Start:* ${booking.start_time}\n` +
          `🕕 *End:* ${booking.end_time}\n` +
          `👤 *User:* ${ctx.from?.username || "Unknown"}`,
          { parse_mode: "Markdown" }
        );
      } catch {
        await ctx.reply(
          `✅ Booking created successfully!\n\n` +
          `🔖 *Booking Summary:*\n` +
          `🏢 *Venue:* ${venueName}\n` +
          `📝 *Description:* ${booking.desc}\n` +
          `🕒 *Start:* ${booking.start_time}\n` +
          `🕕 *End:* ${booking.end_time}\n` +
          `👤 *User:* ${ctx.from?.username || "Unknown"}`,
          { parse_mode: "Markdown" }
        );
      }

      delete ctx.session.currentBooking;

    } catch (error) {
      console.error('Booking creation error:', error);
      try {
        await ctx.editMessageText(
          "❌ Error creating booking. Please try again later.\n\n" +
          "If the problem persists, contact support.",
          { parse_mode: "Markdown" }
        );
      } catch {
        await ctx.reply(
          "❌ Error creating booking. Please try again later.\n\n" +
          "If the problem persists, contact support.",
          { parse_mode: "Markdown" }
        );
      }
      delete ctx.session.currentBooking;
    }
  }
);

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
    AccessToken: Bun.env.BOT_TOKEN || "",
    TelegramId: String(ctx.from?.id || ""),
    TelegramUsername: ctx.from?.username || "",
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
      Markup.button.callback(`${getVenueEmoji(venue.name)} ${venue.name}`, `book_venue_${venue.id}`),
    ]);
    await ctx.reply("📅 Select a venue to book:", {
      reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
      parse_mode: "Markdown"
    });
  } catch (error) {
    ctx.reply("Error fetching venues. Please try again later.");
  }
});

bot.action(/^book_venue_(\d+)$/, async (ctx) => {
  console.log("Book venue action triggered");
  const match = ctx.match;
  if (match && match[1]) {
    const venueId = parseInt(match[1]);
    await ctx.answerCbQuery();
    if (!ctx.session) {
      ctx.session = {
        currentBooking: undefined,
        booking: undefined
      };
    }
    try {
      // Delete the original message with venue selection
      if (ctx.callbackQuery.message) {
        await ctx.deleteMessage();
      }
    } catch (error) {
      console.error("Error deleting message:", error);
    }
    await calendar.startBookingFlow(ctx, venueId);
  } else {
    await ctx.answerCbQuery("Invalid venue selection");
    await ctx.reply("Please try booking again with a valid venue.");
  }
});

// My bookings command
bot.command("mybookings", async (ctx) => {
  console.log("mybookings command called");

  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx,
      null,
      {
        page: 1,
        size: 50,
      }
    );

    if (!response.items || response.items.length === 0) {
      ctx.reply("You have no bookings.");
    } else {
      const bookingList = response.items
        .map((booking: any) => {
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

bot.command("test", async (ctx) => {
  try {
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

bot.command("allbookings", async (ctx) => {
  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx
    );
    const bookings = response.items as components["schemas"]["GetBookingRequest"][];
    if (!bookings || bookings.length === 0) {
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

bot.command("getbooking", async (ctx) => {
  const bookingId = ctx.message?.text.split(" ")[1];
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
    const booking = response.items.find((b: any) => b.id === parseInt(bookingId));
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

bot.command("deletebooking", async (ctx) => {
  const bookingId = ctx.message?.text.split(" ")[1];
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

bot.command("getvenue", async (ctx) => {
  const venueId = ctx.message?.text.split(" ")[1];
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

// Callback query handler
bot.on('callback_query', async (ctx) => {
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    await calendar.handleCallbackQuery(ctx);
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply("An error occurred. Please try again later.");
  throw err;
});

// Launch the bot after all handlers are set
bot.launch().catch((err) => {
  console.error("Error launching bot:", err);
  process.exit(1);
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
