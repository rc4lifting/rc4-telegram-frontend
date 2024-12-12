import { Telegraf, Context, Markup } from "telegraf";
import { session } from "telegraf";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { components, operations } from "../schema/schema.d";
import { GoogleSheetsService } from "./services/GoogleSheetsService";
import { updateVenueDataInSheets } from "./services/VenueDataService";
import { DateTime } from "luxon";

export type BookingStep = "start_date" | "start_time" | "end_date" | "end_time" | "confirm";

export interface SessionData {
  currentBooking?: {
    step: BookingStep;
    startDate?: string;   // ISO date string (date only or full date/time)
    startTime?: string;   // Time in HH:mm format
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
  start_date: string; // ISO date (yyyy-mm-dd)
  start_time: string; // HH:mm
  end_date: string;   // ISO date (yyyy-mm-dd)
  end_time: string;   // HH:mm
}

interface BookingCalendarOptions {
  dateRangeDays?: number;
  maxWeeks?: number;
  timeStepMinutes?: number;
  startHour?: number;
  endHour?: number;
  timezone?: string;
}

export class BookingCalendar {
  bot: Telegraf<SessionContext>;
  dateRangeDays: number;
  maxWeeks: number;
  timeStepMinutes: number;
  startHour: number;
  endHour: number;
  private timezone: string;
  private onBookingDataReady?: (bookingData: CalendarBookingData, ctx: SessionContext) => Promise<void>;

  constructor(
    bot: Telegraf<SessionContext>, 
    options?: BookingCalendarOptions,
    onBookingDataReady?: (bookingData: CalendarBookingData, ctx: SessionContext) => Promise<void>
  ) {
    this.bot = bot;
    this.dateRangeDays = options?.dateRangeDays || 7;
    this.maxWeeks = options?.maxWeeks || 2;
    this.timeStepMinutes = options?.timeStepMinutes || 30;
    this.startHour = options?.startHour || 8;
    this.endHour = options?.endHour || 20;
    this.timezone = options?.timezone || 'Asia/Singapore';
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
          const dateObj = DateTime.fromISO(dateISO, { zone: this.timezone });
          await ctx.answerCbQuery(`Selected start date: ${this.formatDate(dateObj)}`);
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
          // Automatically set end date to start date
          state.endDate = state.startDate;
          state.step = "end_time";
          // Skip end date selection and go straight to end time
          await this.renderEndTimeSelection(ctx, state.startDate!, state.startTime!, state.endDate!);
        }
        break;

      case "end_date":
        if (data.startsWith("end_date_")) {
          const dateISO = data.replace("end_date_", "");
          const dateObj = DateTime.fromISO(dateISO, { zone: this.timezone });
          await ctx.answerCbQuery(`Selected end date: ${this.formatDate(dateObj)}`);
          state.endDate = dateISO;
          state.step = "end_time";
          await this.renderEndTimeSelection(ctx, state.startDate!, state.startTime!, dateISO);
        }
        break;

      case "end_time":
        if (data === "change_end_date") {
          await ctx.answerCbQuery("Change end date");
          state.step = "end_date";
          state.endOffset = 0;
          await this.renderEndDateSelection(ctx, 0);
        }
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
    try {
      const date = DateTime.fromISO(dateISO, { zone: this.timezone });
      const now = DateTime.local().setZone(this.timezone);

      // Fetch existing bookings
      const response = await apiRequest(
        "get_bookings_telegram_booking__get",
        "/telegram/booking/",
        ctx,
        null,
        {
          venueId: ctx.session.currentBooking?.venue_id,
          page: 1,
          size: 50
        }
      );

      const existingBookings = response.items as components["schemas"]["GetBookingRequest"][];
      const slots = await this.generateTimeSlots(date, now, true, undefined, existingBookings);

      if (slots.length === 0) {
        const message = date < now 
          ? "Cannot book slots in the past. Please select a future date."
          : "All slots are booked for this date. Please select another date.";

        try {
          await ctx.editMessageText(message);
        } catch {
          await ctx.reply(message);
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

      const messageText = 
        `Start Date: ${this.formatDate(date)}\n\n` +
        `Select a *start time*:\n` +
        `_(${slots.length} slots available)_`;

      try {
        await ctx.editMessageText(messageText, { 
          parse_mode: "Markdown", 
          reply_markup: markup 
        });
      } catch {
        await ctx.reply(messageText, { 
          parse_mode: "Markdown", 
          reply_markup: markup 
        });
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
      await ctx.reply("Error checking availability. Please try again later.");
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
    try {
      const startDate = DateTime.fromISO(startDateISO, { zone: this.timezone });
      const endDate = DateTime.fromISO(endDateISO, { zone: this.timezone });

      const [startHour, startMin] = startTime.split(":").map(Number);
      const startDateTime = startDate.set({ hour: startHour, minute: startMin });
      
      const response = await apiRequest(
        "get_bookings_telegram_booking__get",
        "/telegram/booking/",
        ctx,
        null,
        {
          venueId: ctx.session.currentBooking?.venue_id,
          page: 1,
          size: 50
        }
      );

      const existingBookings = response.items as components["schemas"]["GetBookingRequest"][];
      const now = DateTime.local().setZone(this.timezone);
      let slots: string[];

      if (startDate.hasSame(endDate, 'day')) {
        // Same day: end times must be after startDateTime
        slots = await this.generateTimeSlots(endDate, now, false, startDateTime, existingBookings);
      } else {
        // Different day: we can pick any slot after now (or future)
        slots = await this.generateTimeSlots(endDate, now, true, undefined, existingBookings);
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
      const changeDateButton = Markup.button.callback("📅 Change End Date", "change_end_date");
      const markup = {
        inline_keyboard: [
          ...this.chunkButtons(buttons, 4),
          [changeDateButton],
          [Markup.button.callback("❌ Cancel", "cancel_booking")]
        ]
      };

      try {
        await ctx.editMessageText(
          `Start: ${this.formatDateTime(startDate, startTime)}\nEnd Date: ${this.formatDate(endDate)}\n\nSelect an *end time*:`,
          { parse_mode: "Markdown", reply_markup: markup }
        );
      } catch {
        await ctx.reply(
          `Start: ${this.formatDateTime(startDate, startTime)}\nEnd Date: ${this.formatDate(endDate)}\n\nSelect an *end time*:`,
          { parse_mode: "Markdown", reply_markup: markup }
        );
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
      await ctx.reply("Error checking availability. Please try again later.");
    }
  }

  private async renderConfirmation(ctx: SessionContext, startDateISO: string, startTime: string, endDateISO: string, endTime: string) {
    const startDate = DateTime.fromISO(startDateISO, { zone: this.timezone });
    const endDate = DateTime.fromISO(endDateISO, { zone: this.timezone });

    const startStr = this.formatDateTime(startDate, startTime);
    const endStr = this.formatDateTime(endDate, endTime);
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
    const now = DateTime.local().setZone(this.timezone).startOf('day');
    const buttons: any[] = [];
    for (let i = 0; i < this.dateRangeDays; i++) {
      const day = now.plus({ days: i + offset * this.dateRangeDays });
      const label = this.formatShortDate(day);
      // Storing just the date in ISO format (yyyy-mm-dd)
      const isoDate = day.toISODate(); 
      buttons.push(Markup.button.callback(label, `${prefix}${isoDate}`));
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

  private async generateTimeSlots(
    date: DateTime,
    now: DateTime,
    isStartTime: boolean,
    startDateTime?: DateTime,
    existingBookings?: components["schemas"]["GetBookingRequest"][]
  ): Promise<string[]> {
    const slots: string[] = [];
    // We consider the day in the given timezone
    const targetDate = date.startOf('day');

    for (let hour = this.startHour; hour <= this.endHour; hour++) {
      for (let min = 0; min < 60; min += this.timeStepMinutes) {
        const slotDate = targetDate.set({ hour, minute: min });

        // Check if booked
        const isBooked = existingBookings?.some(booking => {
          const tzBookingStart = DateTime.fromISO(booking.start_time, { zone: this.timezone });
          const tzBookingEnd = DateTime.fromISO(booking.end_time, { zone: this.timezone });
          return slotDate >= tzBookingStart && slotDate < tzBookingEnd;
        });
        if (isBooked) continue;

        if (!isStartTime) {
          // Find the earliest booking start time after startDateTime
          let earliestNextBookingStart: DateTime | null = null;
          if (existingBookings && startDateTime) {
            for (const booking of existingBookings) {
              const tzBookingStart = DateTime.fromISO(booking.start_time, { zone: this.timezone });
              if (tzBookingStart > startDateTime) {
                if (!earliestNextBookingStart || tzBookingStart < earliestNextBookingStart) {
                  earliestNextBookingStart = tzBookingStart;
                }
              }
            }
          }

          // Don't allow end times that would overlap with next booking
          if (earliestNextBookingStart && slotDate >= earliestNextBookingStart) {
            break;
          }

          // Ensure end time is after start time on same day
          if (startDateTime && slotDate <= startDateTime) continue;
        }

        if (isStartTime) {
          // For start times, slot must be in the future
          if (slotDate > now) {
            slots.push(this.formatTime(slotDate));
          }
        } else {
          // For end times, must be after the startDateTime if same day
          if (startDateTime) {
            if (slotDate > startDateTime) {
              slots.push(this.formatTime(slotDate));
            }
          } else {
            // If no startDateTime (different day scenario), just ensure it's after now
            if (slotDate > now) {
              slots.push(this.formatTime(slotDate));
            }
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

  private formatDate(date: DateTime): string {
    // Example: Mon, Sep 13, 2024
    return date.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatShortDate(date: DateTime): string {
    // Example: Sep 13
    return date.toLocaleString({ month: 'short', day: 'numeric' });
  }

  private formatTime(date: DateTime): string {
    // 24-hour HH:mm
    return date.toFormat('HH:mm');
  }

  private formatDateTime(date: DateTime, time: string): string {
    // Combine date and time strings for display
    return `${this.formatDate(date)} ${time}`;
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
const API_BASE_URL = Bun.env.API_BASE_URL || "";
const TIMEZONE = process.env.TIMEZONE || 'Asia/Singapore';

// Initialize calendar with validation and booking logic
const calendar = new BookingCalendar(
  bot,
  {
    dateRangeDays: 14,
    timeStepMinutes: 30,
    startHour: 8,
    endHour: 20,
    timezone: TIMEZONE
  },
  async (bookingData: CalendarBookingData, ctx: SessionContext) => {
    try {
      // Convert the date and time strings to DateTime objects in the local timezone first
      const startDate = DateTime.fromISO(bookingData.start_date, { zone: TIMEZONE });
      const endDate = DateTime.fromISO(bookingData.end_date, { zone: TIMEZONE });
      
      // Parse the time strings
      const [startHour, startMin] = bookingData.start_time.split(':').map(Number);
      const [endHour, endMin] = bookingData.end_time.split(':').map(Number);
      
      // Create full DateTime objects with the correct date and time
      const startDT = startDate.set({ hour: startHour, minute: startMin });
      const endDT = endDate.set({ hour: endHour, minute: endMin });
      
      // Get current time in the correct timezone
      const now = DateTime.now().setZone(TIMEZONE);
      
      if (endDT <= startDT) {
        await ctx.reply("❌ End time must be after start time. Please try again.");
        return;
      }

      if (endDT <= now) {
        await ctx.reply("❌ End time must be in the future. Please try again.");
        return;
      }

      const booking: components["schemas"]["CreateBookingRequest"] = {
        venue_id: bookingData.venue_id,
        start_time: startDT.toUTC().toISO()!,
        end_time: endDT.toUTC().toISO()!,
        users: ctx.from?.username ? [ctx.from.username] : [],
        desc: `Venue booking by ${ctx.from?.username || 'Unknown user'}`
      };

      console.log('Booking data:', {
        start_time: booking.start_time,
        end_time: booking.end_time
      });

      try {
        await apiRequest(
          "add_booking_telegram_booking__post",
          "/telegram/booking/",
          ctx,
          booking
        );
      } catch (error: any) {
        // Improved error message extraction
        let errorMessage = "Unknown error occurred";
        if (axios.isAxiosError(error)) {
          const responseData = error.response?.data;
          if (responseData) {
            if (typeof responseData === 'string') {
              errorMessage = responseData;
            } else if (typeof responseData === 'object') {
              errorMessage = responseData.detail || 
                           responseData.message || 
                           responseData.error ||
                           (Array.isArray(responseData) ? responseData[0] : null) ||
                           JSON.stringify(responseData);
            }
          }
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        const userMessage = `❌ Booking failed: ${errorMessage}\n\nPlease try again or contact support if the issue persists.`;
        
        try {
          await ctx.editMessageText(userMessage, { parse_mode: "Markdown" });
        } catch {
          await ctx.reply(userMessage, { parse_mode: "Markdown" });
        }
        delete ctx.session.currentBooking;
        return;
      }

      // Get venue details
      const venueResponse = await apiRequest(
        "get_venues_telegram_venue__get",
        "/telegram/venue/",
        ctx
      );
      const venues = venueResponse.items as components["schemas"]["Venue"][];
      const venue = venues.find(v => v.id === booking.venue_id);
      const venueName = venue ? venue.name : "Unknown venue";

      const formattedStart = startDT.toLocaleString({
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      const formattedEnd = endDT.toLocaleString({
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      try {
        await ctx.editMessageText(
          `✅ Booking created successfully!\n\n` +
          `🔖 *Booking Summary:*\n` +
          `🏢 *Venue:* ${venueName}\n` +
          `📝 *Description:* ${booking.desc}\n` +
          `🕒 *Start:* ${formattedStart}\n` +
          `🕕 *End:* ${formattedEnd}\n` +
          `👤 *User:* ${ctx.from?.username || "Unknown"}`,
          { parse_mode: "Markdown" }
        );
      } catch {
        await ctx.reply(
          `✅ Booking created successfully!\n\n` +
          `🔖 *Booking Summary:*\n` +
          `🏢 *Venue:* ${venueName}\n` +
          `📝 *Description:* ${booking.desc}\n` +
          `🕒 *Start:* ${formattedStart}\n` +
          `🕕 *End:* ${formattedEnd}\n` +
          `👤 *User:* ${ctx.from?.username || "Unknown"}`,
          { parse_mode: "Markdown" }
        );
      }

      delete ctx.session.currentBooking;

    } catch (error) {
      console.error('Booking creation error:', error);
      let errorMessage = "An unexpected error occurred";
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      try {
        await ctx.editMessageText(
          `❌ Error creating booking: ${errorMessage}\n\n` +
          "If the problem persists, contact support.",
          { parse_mode: "Markdown" }
        );
      } catch {
        await ctx.reply(
          `❌ Error creating booking: ${errorMessage}\n\n` +
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
  const baseUrl = API_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}${path}`;
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
      console.error(`Response Data: ${JSON.stringify(axiosError.response?.data)}`);
    } else {
      console.error(`Non-Axios Error: ${error}`);
    }
    throw error;
  }
}

// Bot commands and handlers remain largely the same, just ensure they work with the new date handling

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
      "🔎 /getvenue <id> - Get a specific venue\n" +
      "📑 /updatesheets - Update Google Sheets with venue data",
    { parse_mode: "Markdown" }
  )
);

function getVenueEmoji(venueName: string): string {
  const emojiMap: { [key: string]: string } = {
    SR1: "🏢",
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
      const response = await apiRequest(
        "get_venues_telegram_venue__get",
        "/telegram/venue/",
        ctx
      );
      const venues = response.items as components["schemas"]["Venue"][];
      const selectedVenue = venues.find(v => v.id === venueId);
      const venueName = selectedVenue ? selectedVenue.name : "Selected venue";

      await ctx.editMessageText(
        `📍 Selected venue: *${venueName}*\n\nPlease select a booking date:`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Error editing message:", error);
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
  await showBookings(ctx, 1);
});

// Add this new action handler for pagination buttons
bot.action(/^bookings_page_(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await showBookings(ctx, page);
});

// Add a new action handler for deleting a booking from the mybookings list
bot.action(/^delete_booking_(\d+)_(\d+)$/, async (ctx) => {
  console.log("delete_booking_action called");
  // Matches pattern: delete_booking_<bookingId>_<page>
  const bookingId = parseInt(ctx.match[1]);
  const page = parseInt(ctx.match[2]);
  try {
    await ctx.answerCbQuery("Deleting booking...");
    await apiRequest(
      "delete_booking_telegram_booking_deleteBooking_delete",
      `/telegram/booking/deleteBooking`,
      ctx,
      null,
      { bookingId: bookingId.toString() }
    );
    await ctx.answerCbQuery("Booking deleted successfully!");
    // Refresh the booking list after deletion
    await showBookings(ctx, page, true); // pass an indicator to re-edit the message
  } catch (error) {
    console.error("Error deleting booking:", error);
    await ctx.answerCbQuery("Error deleting booking. Please try again.");
  }
});

// Helper function to show bookings with pagination and delete buttons
async function showBookings(ctx: SessionContext, page: number, isRefresh = false) {
  const PAGE_SIZE = 5; // Number of bookings per page
  
  try {
    const response = await apiRequest(
      "get_bookings_telegram_booking__get",
      "/telegram/booking/",
      ctx,
      null,
      {
        page: page,
        size: PAGE_SIZE,
      }
    );

    if (!response.items || response.items.length === 0) {
      const message = "You have no bookings.";
      if (ctx.callbackQuery && isRefresh) {
        await ctx.editMessageText(message);
      } else {
        await ctx.reply(message);
      }
      return;
    }

    const totalPages = Math.ceil(response.total / PAGE_SIZE);
    
    // We'll need to build inline keyboards for each booking with a Delete button
    const bookingLines = [];
    
    // Fetch venues once for all bookings to reduce API calls
    const venueResponse = await apiRequest(
      "get_venues_telegram_venue__get",
      "/telegram/venue/",
      ctx
    );
    const allVenues = venueResponse.items as components["schemas"]["Venue"][];

    for (let i = 0; i < response.items.length; i++) {
      const booking = response.items[i];
      const startTime = DateTime.fromISO(booking.start_time).setZone(TIMEZONE)
        .toLocaleString(DateTime.DATETIME_SHORT);
      const endTime = DateTime.fromISO(booking.end_time).setZone(TIMEZONE)
        .toLocaleString(DateTime.DATETIME_SHORT);

      const venue = allVenues.find(v => v.id === booking.venue_id);
      const venueName = venue ? venue.name : `Unknown (ID: ${booking.venue_id})`;

      bookingLines.push(
        `📌 *Booking ${(page - 1) * PAGE_SIZE + i + 1}*\n` +
        `🏢 *Venue:* ${venueName}\n` +
        `📝 *Description:* ${booking.desc}\n` +
        `🕒 *Start:* ${startTime}\n` +
        `🕕 *End:* ${endTime}`
      );
    }

    const formattedBookings = bookingLines.join("\n\n");
    
    // Create pagination buttons
    const navigationRow = [];
    if (page > 1) {
      navigationRow.push(Markup.button.callback('⬅️ Previous', `bookings_page_${page - 1}`));
    }
    if (page < totalPages) {
      navigationRow.push(Markup.button.callback('Next ➡️', `bookings_page_${page + 1}`));
    }

    const keyboardRows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

    // For each booking, add a delete button row
    response.items.forEach((booking: any) => {
      // Ensure booking.id exists and is valid
      if (booking && booking.id) {
        keyboardRows.push([
          Markup.button.callback(
            "🗑 Delete", 
            `delete_booking_${booking.id}_${page}`
          )
        ]);
      }
    });

    // Add pagination row if needed
    if (navigationRow.length > 0) {
      keyboardRows.push(navigationRow);
    }

    const message = `*Your Bookings (Page ${page}/${totalPages})*\n\n${formattedBookings}`;

    const replyMarkup = Markup.inlineKeyboard(keyboardRows).reply_markup;

    // Try to edit existing message if it's a callback query or send a new message otherwise
    if (ctx.callbackQuery || isRefresh) {
      await ctx.editMessageText(message, {
        parse_mode: "Markdown",
        reply_markup: replyMarkup
      });
    } else {
      await ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: replyMarkup
      });
    }

  } catch (error) {
    console.error("Error in showBookings:", error);
    const errorMessage = ctx.callbackQuery ? 
      "Error updating bookings. Please try again." :
      "Error fetching your bookings. Please try again later.";
    await ctx.reply(errorMessage);
  }
}

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
      `👤 *Your profile:*\n🆔 *NUS Net ID:* ${
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

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply("An error occurred. Please try again later.");
  throw err;
});

// Update sheets command
bot.command("updatesheets", async (ctx) => {
  try {
    await ctx.reply("🔄 Starting venue data update...");
    
    const result = await updateVenueDataInSheets(ctx);
    
    if (!result.success) {
      await ctx.reply(
        "ℹ️ No updates needed - data unchanged since last update",
        { parse_mode: "Markdown" }
      );
      return;
    }
    
    await ctx.reply(
      `✅ Successfully updated Google Sheets!\n\n` +
      `📊 *Summary:*\n` +
      `• Venues processed: ${result.venuesCount}\n` +
      `• Bookings processed: ${result.bookingsCount}\n\n` +
      `🔗 Sheet URL: ${process.env.GOOGLE_SHEETS_URL || "Not configured"}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in updatesheets command:", error);
    await ctx.reply(
      "❌ Failed to update Google Sheets. Please check the logs or contact support.",
      { parse_mode: "Markdown" }
    );
  }
});

// Launch the bot
bot.launch().catch((err) => {
  console.error("Error launching bot:", err);
  process.exit(1);
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
