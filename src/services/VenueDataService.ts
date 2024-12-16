import { GoogleSheetsService } from "./GoogleSheetsService";
import { components, operations } from "../../schema/schema.d";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import { SessionContext } from "../bot";

interface AuthContext {
  telegramId?: string;
  telegramUsername?: string;
  botToken: string;
}

// Add a logging utility
const logger = {
  info: (message: string, context = {}) => {
    console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message, ...context }));
  },
  error: (message: string, error: any, context = {}) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      ...context
    }));
  }
};

export async function updateVenueDataInSheets(
  auth: AuthContext | SessionContext
): Promise<{
  success: boolean;
  venuesCount: number;
  bookingsCount: number;
  message?: string;
}> {
  const startTime = Date.now();
  logger.info('Starting venue data update', { 
    telegramId: 'from' in auth ? auth.from?.id : auth.telegramId 
  });

  // Extract auth details regardless of input type
  const authDetails: AuthContext = {
    botToken: 'from' in auth ? Bun.env.BOT_TOKEN! : auth.botToken,
    telegramId: 'from' in auth ? String(auth.from?.id) : auth.telegramId,
    telegramUsername: 'from' in auth ? auth.from?.username : auth.telegramUsername
  };
  
  try {
    const spreadsheetId = Bun.env.GOOGLE_SHEETS_ID;
    if (!spreadsheetId) {
      throw new Error("Missing GOOGLE_SHEETS_ID environment variable");
    }

    // Fetch venues with retry logic
    let venues: components["schemas"]["Venue"][] = [];
    let retries = 3;
    while (retries > 0) {
      try {
        logger.info('Fetching venues', { attemptNumber: 4 - retries });
        const venuesResponse = await apiRequest(
          "get_venues_telegram_venue__get",
          "/telegram/venue/",
          authDetails
        );
        venues = venuesResponse.items;
        logger.info('Successfully fetched venues', { count: venues.length });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        logger.error('Venue fetch attempt failed, retrying...', error, { 
          remainingRetries: retries 
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Fetch bookings with retry logic
    let bookings: components["schemas"]["GetBookingRequest"][] = [];
    retries = 3;
    while (retries > 0) {
      try {
        const bookingsResponse = await apiRequest(
          "get_bookings_admin_telegram_booking_get_admin_get",
          "/telegram/booking/get_admin",
          authDetails,
          undefined,
          { page: 1, size: 100 }
        );
        bookings = bookingsResponse.items;
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!venues.length || !bookings.length) {
      logger.info('No data available for update', { 
        venuesCount: venues.length, 
        bookingsCount: bookings.length 
      });
      return {
        success: false,
        message: "No data to update",
        venuesCount: 0,
        bookingsCount: 0
      };
    }

    const sheetsService = new GoogleSheetsService(spreadsheetId);
    await sheetsService.updateVenueBookings(bookings, venues);

    const duration = Date.now() - startTime;
    logger.info('Venue data update completed', {
      duration: `${duration}ms`,
      venuesCount: venues.length,
      bookingsCount: bookings.length
    });

    return {
      success: true,
      message: "Venue data successfully updated in Google Sheets",
      venuesCount: venues.length,
      bookingsCount: bookings.length
    };
  } catch (error) {
    logger.error('Failed to update venue data in sheets', error, {
      duration: `${Date.now() - startTime}ms`
    });
    throw error;
  }
}

/**
 * Makes an API request using axios.
 * 
 * @param operationId - The unique identifier for the API operation.
 * @param path - The API endpoint path.
 * @param auth - The authentication context.
 * @param data - Optional request payload.
 * @param params - Optional query parameters.
 * @returns The response data from the API.
 */
async function apiRequest<T extends keyof operations>(
  operationId: T,
  path: string,
  auth: AuthContext,
  data?: any,
  params?: any
): Promise<any> {
  const API_BASE_URL = Bun.env.API_BASE_URL || "";
  const url = `${API_BASE_URL}${path}`;

  const methodMap: Record<string, string> = {
    get_venues_telegram_venue__get: "GET",
    get_bookings_admin_telegram_booking_get_admin_get: "GET"
  };
  const method = methodMap[operationId] || "GET";

  logger.info('Making API request', {
    method,
    path,
    operationId,
    hasParams: !!params
  });

  const headers = {
    "Content-Type": "application/json",
    AccessToken: auth.botToken,
    TelegramId: auth.telegramId || "",
    TelegramUsername: auth.telegramUsername || "",
  };

  const config: AxiosRequestConfig = {
    method,
    url,
    data,
    params,
    headers,
  };

  try {
    const response = await axios(config);
    logger.info('API request successful', {
      status: response.status,
      path,
      dataSize: JSON.stringify(response.data).length
    });
    return response.data;
  } catch (error) {
    logger.error('API request failed', error instanceof AxiosError ? {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    } : error, {
      path,
      method
    });
    throw error;
  }
}
