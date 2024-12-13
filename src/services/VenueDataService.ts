import { GoogleSheetsService } from "./GoogleSheetsService";
import { components, operations } from "../../schema/schema.d";
import axios, { AxiosRequestConfig } from "axios";
import { SessionContext } from "../bot";

export async function updateVenueDataInSheets(ctx: SessionContext) {
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
                const venuesResponse = await apiRequest(
                    "get_venues_telegram_venue__get",
                    "/telegram/venue/",
                    ctx
                );
                venues = venuesResponse.items;
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Fetch bookings with retry logic
        let bookings: components["schemas"]["GetBookingRequest"][] = [];
        retries = 3;
        while (retries > 0) {
            try {
                const bookingsResponse = await apiRequest(
                    "get_bookings_telegram_booking__get",
                    "/telegram/booking/",
                    ctx,
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
            return {
                success: false,
                message: "No data to update",
                venuesCount: 0,
                bookingsCount: 0
            };
        }

        const sheetsService = new GoogleSheetsService(spreadsheetId);
        await sheetsService.updateVenueBookings(bookings, venues);

        return {
            success: true,
            message: "Venue data successfully updated in Google Sheets",
            venuesCount: venues.length,
            bookingsCount: bookings.length
        };
    } catch (error) {
        console.error("Error updating venue data in sheets:", error);
        throw error;
    }
}

/**
 * Makes an API request using axios.
 * 
 * @param operationId - The unique identifier for the API operation.
 * @param path - The API endpoint path.
 * @param ctx - The session context (for headers).
 * @param data - Optional request payload.
 * @param params - Optional query parameters.
 * @returns The response data from the API.
 */
async function apiRequest<T extends keyof operations>(
    operationId: T,
    path: string,
    ctx: SessionContext,
    data?: any,
    params?: any
): Promise<any> {
    const API_BASE_URL = Bun.env.API_BASE_URL || "";
    const url = `${API_BASE_URL}${path}`;

    // Map operationId to the appropriate HTTP method
    const methodMap: Record<string, string> = {
        get_venues_telegram_venue__get: "GET",
        get_bookings_telegram_booking__get: "GET"
    };
    const method = methodMap[operationId] || "GET";

    const headers = {
        "Content-Type": "application/json",
        AccessToken: Bun.env.BOT_TOKEN || "",
        TelegramId: String(ctx.from?.id || ""),
        TelegramUsername: ctx.from?.username || "",
    };

    const config: AxiosRequestConfig = {
        method,
        url,
        data,
        params,
        headers,
    };

    try {
        console.log(`Making ${method} request to ${url}...`);
        const response = await axios(config);
        console.log(`Received response: HTTP ${response.status}`);
        return response.data;
    } catch (error) {
        console.error(`API request failed for ${url}:`, error);
        throw error;
    }
}
