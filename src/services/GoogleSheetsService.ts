import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { components } from '../schema/schema';
import crypto from 'crypto';
import { DateTime } from 'luxon';

interface TimeSlot {
  time: string;
}

export class GoogleSheetsService {
  private doc: GoogleSpreadsheet;
  private metadataTitle = 'Metadata';
  private summaryTitle = 'Summary';

  private readonly TIMEZONE: string;

  constructor(spreadsheetId: string, timeZone?: string) {
    this.TIMEZONE = timeZone || Bun.env.TIMEZONE || 'Asia/Singapore';

    const email = Bun.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = Bun.env.GOOGLE_PRIVATE_KEY;
    if (!email || !privateKey) {
      throw new Error("Google service account credentials not configured");
    }

    const serviceAccountAuth = new JWT({
      email,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });

    this.doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
  }

  /**
   * Main entry point to update venue bookings and summary sheets.
   * - Updates summary sheet if global data changes.
   * - For each venue, updates venue sheet if that venue's data changed.
   */
  async updateVenueBookings(
    bookings: components["schemas"]["GetBookingRequest"][], 
    venues: components["schemas"]["Venue"][]
  ) {
    await this.doc.loadInfo();
    
    // Calculate global hash
    const globalHash = this.calculateGlobalHash(bookings, venues);
    const metadataSheet = await this.setupMetadataSheet();

    // Check global hash, update summary if changed
    const { globalChanged } = await this.checkAndUpdateGlobalHash(metadataSheet, globalHash);
    if (globalChanged) {
      await this.updateSummarySheet(bookings, venues);
    }

    // Now check each venue
    for (const venue of venues) {
      const venueBookings = bookings.filter(b => b.venue_id === venue.id);
      const venueHash = this.calculateVenueHash(venueBookings, venue);

      const venueChanged = await this.checkAndUpdateVenueHash(metadataSheet, venue, venueHash);
      if (venueChanged) {
        await this.updateVenueTimetable(venue, venueBookings);
      }
    }

    return { updated: true, venuesCount: venues.length, bookingsCount: bookings.length };
  }

  /**
   * Sets up Metadata sheet if not present, ensures headers are correct.
   * Metadata headers:
   *   Global Hash | Last Updated | Venue ID | Venue Hash
   * First data row: global hash, last updated
   * Subsequent rows: each row represents a venue with Venue ID and Venue Hash.
   */
  private async setupMetadataSheet(): Promise<GoogleSpreadsheetWorksheet> {
    let metadataSheet = this.doc.sheetsByTitle[this.metadataTitle];
    if (!metadataSheet) {
      metadataSheet = await this.doc.addSheet({
        title: this.metadataTitle,
        headerValues: ['Global Hash', 'Last Updated', 'Venue ID', 'Venue Hash']
      });
    } else {
      await metadataSheet.loadHeaderRow();
      const requiredHeaders = ['Global Hash', 'Last Updated', 'Venue ID', 'Venue Hash'];
      if (requiredHeaders.some(h => !metadataSheet.headerValues.includes(h))) {
        await metadataSheet.setHeaderRow(requiredHeaders);
      }
    }
    return metadataSheet;
  }

  /**
   * Check and update the global hash. If changed, update the row. If no row yet, create one.
   */
  private async checkAndUpdateGlobalHash(metadataSheet: GoogleSpreadsheetWorksheet, newHash: string) {
    const rows = await metadataSheet.getRows();
    const lastUpdated = this.formatDate(DateTime.now().setZone(this.TIMEZONE));

    // The first data row (if any) is the global hash row
    let globalChanged = false;
    if (rows.length === 0) {
      // No global hash row yet
      await metadataSheet.addRow({
        'Global Hash': newHash,
        'Last Updated': lastUpdated
      });
      globalChanged = true;
    } else {
      const globalRow = rows[0];
      const existingHash = globalRow.get('Global Hash') || '';
      if (existingHash !== newHash) {
        globalRow.set('Global Hash', newHash);
        globalRow.set('Last Updated', lastUpdated);
        await globalRow.save();
        globalChanged = true;
      }
    }

    return { globalChanged };
  }

  /**
   * Check and update a specific venue hash. If changed, update/create that venue's row.
   */
  private async checkAndUpdateVenueHash(
    metadataSheet: GoogleSpreadsheetWorksheet,
    venue: components["schemas"]["Venue"],
    newHash: string
  ) {
    const rows = await metadataSheet.getRows();
    // Skip the first row (global hash) when looking for venue rows
    const venueRows = rows.slice(1);

    // Find the specific venue row
    let venueRow = venueRows.find(r => r.get('Venue ID') === venue.id?.toString());
    let venueChanged = false;

    if (!venueRow) {
      // Add a new row at the end for this venue
      await metadataSheet.addRow({
        'Venue ID': venue.id?.toString() || '',
        'Venue Hash': newHash,
        'Last Updated': this.formatDate(DateTime.now().setZone(this.TIMEZONE))
      });
      venueChanged = true;
    } else {
      const existingHash = venueRow.get('Venue Hash') || '';
      if (existingHash !== newHash) {
        // Update the existing row for this specific venue
        venueRow.set('Venue Hash', newHash);
        venueRow.set('Last Updated', this.formatDate(DateTime.now().setZone(this.TIMEZONE)));
        await venueRow.save();
        venueChanged = true;
      }
    }

    return venueChanged;
  }

  /**
   * Update the summary sheet with all bookings.
   * Only called if global data changes.
   */
  private async updateSummarySheet(
    bookings: components["schemas"]["GetBookingRequest"][],
    venues: components["schemas"]["Venue"][]
  ) {
    let sheet = this.doc.sheetsByTitle[this.summaryTitle];
    if (!sheet) {
      sheet = await this.doc.addSheet({
        title: this.summaryTitle,
        headerValues: ['Venue', 'Description', 'Start Time', 'End Time', 'Booked By', 'Status']
      });
    } else {
      await sheet.clearRows();
    }

    const rows = bookings.map(booking => {
      const venue = venues.find(v => v.id === booking.venue_id);
      const bookers = booking.users?.map(u => u.name).join(', ') || 'Unknown';
      return {
        Venue: venue?.name || 'Unknown',
        Description: booking.desc,
        'Start Time': DateTime.fromISO(booking.start_time)
          .setZone(this.TIMEZONE)
          .toFormat('dd/MM/yyyy HH:mm'),
        'End Time': DateTime.fromISO(booking.end_time)
          .setZone(this.TIMEZONE)
          .toFormat('dd/MM/yyyy HH:mm'),
        'Booked By': bookers,
        Status: 'Active'
      };
    });

    if (rows.length > 0) {
      await sheet.addRows(rows);
    }
  }

  /**
   * Update or create a venue timetable. Called only if that venue's data changed.
   * Applies cell coloring based on booking status:
   *   FREE = green background
   *   Booked = red background, bold text
   */
  private async updateVenueTimetable(
    venue: components["schemas"]["Venue"],
    bookings: components["schemas"]["GetBookingRequest"][]
  ) {
    const sheetTitle = `${venue.name} Timetable`;
    let sheet = this.doc.sheetsByTitle[sheetTitle];

    // Create the sheet if doesn't exist
    if (!sheet) {
      sheet = await this.doc.addSheet({ title: sheetTitle });
    }

    // Clear existing data (not headers)
    await sheet.clear();

    const dates = this.generateDates(14);
    const timeSlots = this.generateTimeSlots();
    const headerRow = ['TIME SLOT', ...dates.map((date) => this.formatDateHeader(date))];
    await sheet.setHeaderRow(headerRow);

    // Initialize all rows with "FREE"
    const rows = timeSlots.map(slot => {
      const row: { [key: string]: string } = { 'TIME SLOT': slot.time };
      for (const dateStr of dates) {
        row[this.formatDateHeader(dateStr)] = 'FREE';
      }
      return row;
    });

    // Mark booked slots
    for (const booking of bookings) {
      this.markBookedSlots(rows, timeSlots, dates, booking);
    }

    // Add rows in bulk
    if (rows.length > 0) {
      await sheet.addRows(rows);
    }

    // Apply formatting colors after all rows added
    await this.applyTimetableFormatting(sheet, headerRow.length, rows.length);
  }

  /**
   * Apply formatting:
   * - Header row: bold, grey background
   * - FREE cells: green background
   * - Booked cells: red background, bold text
   */
  private async applyTimetableFormatting(sheet: GoogleSpreadsheetWorksheet, cols: number, rows: number) {
    await sheet.loadCells(`A1:${String.fromCharCode(65 + cols - 1)}${rows+1}`);
    
    // Header row formatting
    for (let col = 0; col < cols; col++) {
      const cell = sheet.getCell(0, col);
      cell.textFormat = { bold: true };
      cell.backgroundColor = { red: 0.8, green: 0.8, blue: 0.8 };
    }

    // Data cells formatting
    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col < cols; col++) {
        const cell = sheet.getCell(row, col);
        if (cell.value === 'FREE') {
          cell.backgroundColor = { red: 0.9, green: 1, blue: 0.9 };
          cell.textFormat = { bold: false };
        } else if (typeof cell.value === 'string' && cell.value.trim() !== 'FREE') {
          cell.backgroundColor = { red: 1, green: 0.9, blue: 0.9 };
          cell.textFormat = { bold: true };
        }
      }
    }

    await sheet.saveUpdatedCells();
  }

  /**
   * Mark booked slots for a single booking.
   */
  private markBookedSlots(
    rows: { [key: string]: string }[],
    timeSlots: { time: string }[],
    dates: string[],
    booking: components["schemas"]["GetBookingRequest"]
  ) {
    // Parse the ISO strings (stored in UTC) then convert to the target timezone.
    const startDateTime = DateTime.fromISO(booking.start_time).setZone(this.TIMEZONE);
    const endDateTime = DateTime.fromISO(booking.end_time).setZone(this.TIMEZONE);
    const bookerName = booking.users?.[0]?.name || 'Unknown';

    let current = startDateTime.startOf('day');
    while (current <= endDateTime) {
      const dateStr = current.toISODate()!;
      if (!dates.includes(dateStr)) {
        current = current.plus({ days: 1 });
        continue;
      }

      const dateColumn = this.formatDateHeader(dateStr);
      for (let i = 0; i < timeSlots.length; i++) {
        const slotStartStr = timeSlots[i].time.split(' - ')[0];
        const [slotHour, slotMin] = slotStartStr.split(':').map(Number);
        const slotTime = DateTime.fromISO(dateStr, { zone: this.TIMEZONE })
          .set({ hour: slotHour, minute: slotMin });

        if (slotTime >= startDateTime && slotTime < endDateTime) {
          rows[i][dateColumn] = bookerName;
        }
      }

      current = current.plus({ days: 1 });
    }
  }

  /**
   * Calculate global hash based on all bookings and venues.
   */
  private calculateGlobalHash(
    bookings: components["schemas"]["GetBookingRequest"][],
    venues: components["schemas"]["Venue"][]
  ): string {
    const data = JSON.stringify({ bookings, venues });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Calculate hash for a specific venue's bookings.
   */
  private calculateVenueHash(
    venueBookings: components["schemas"]["GetBookingRequest"][],
    venue: components["schemas"]["Venue"]
  ): string {
    const data = JSON.stringify({ venue, bookings: venueBookings });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate half-hour time slots for 24h.
   */
  private generateTimeSlots(): { time: string }[] {
    const slots: { time: string }[] = [];
    const baseDate = DateTime.fromObject({ year: 2024, month: 1, day: 1 }, { zone: this.TIMEZONE });
    
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30]) {
        const startTime = baseDate.set({ hour, minute });
        const endTime = startTime.plus({ minutes: 30 });
        
        slots.push({
          time: `${startTime.toFormat('HH:mm')} - ${endTime.toFormat('HH:mm')}`
        });
      }
    }
    
    return slots;
  }

  /**
   * Generate a list of ISO date strings for 'days' days from now.
   */
  private generateDates(days: number): string[] {
    const today = DateTime.now().setZone(this.TIMEZONE).startOf('day');
    return Array.from({ length: days }, (_, i) => 
      today.plus({ days: i }).toISODate()!
    );
  }

  /**
   * Format date headers as dd/mm/yyyy
   */
  private formatDateHeader(dateStr: string): string {
    return DateTime.fromISO(dateStr)
      .setZone(this.TIMEZONE)
      .toFormat('dd/MM/yyyy');
  }

  /**
   * Format date to GMT+8 friendly string
   */
  private formatDate(date: DateTime): string {
    return date.setZone(this.TIMEZONE).toFormat('MMMM dd, yyyy HH:mm:ss ZZZZ');
  }
}