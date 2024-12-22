import { Browser, Page, ElementHandle, Frame } from "puppeteer";
import puppeteer from "puppeteer";

interface UsageTypeSignature {
    [key: string]: string;
}

export interface Credentials {
    utownfbs_username: string;
    utownfbs_password: string;
}

export class FBSInteractor {

    constructor() {}

    static VENUES = [
        { id: 1, name: "SR1", desc: "Seminar Room 1", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "4ada4203-06ab-48ac-8a14-1bb8c26474e2"},
        { id: 2, name: "SR2", desc: "Seminar Room 2", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "c353d4b6-dff1-4006-a4db-d7fa49659ffc"},
        { id: 3, name: "SR3", desc: "Seminar Room 3", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "c9c6f9d5-9b42-4978-aed1-a1b86af20365"},
        { id: 4, name: "SR4", desc: "Seminar Room 4", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "e0568195-98af-403c-b3cf-0350e443e403"},
        { id: 5, name: "SR5", desc: "Seminar Room 5", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "8f070a07-7ab2-4194-b841-f53304e7f2a6"},
        { id: 6, name: "TR1", desc: "Theme Room 1", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "c27c5808-e80d-4f1c-9982-aca83c359001"},
        { id: 7, name: "TR2", desc: "Theme Room 2", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "3fa27ba4-9a0b-41f3-9282-15f78943994b"},
        { id: 8, name: "TR3", desc: "Theme Room 3", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "635ed65a-1db0-4201-a40c-77df9ff8e7d8"},
        { id: 9, name: "TR4", desc: "Theme Room 4" , facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "8839f7ab-1a73-4190-b4aa-84e1e6524187"},
        { id: 10, name: "Gym", desc: "Gym", facil_type_value: "b0b1df78-0e74-4b3c-8033-ced5e3e32413", option_value: "32ecb2ef-0600-44b9-97b0-dbf2a1c2bfab" },
        { id: 11, name: "MPSH", desc: "Multi-purpose sports hall", facil_type_value: "775b9829-d80e-4191-bebb-a9219b9c3d10", option_value: "c79604f1-8481-4ca1-be2a-17e273348b21" },
    ];
    
    static USAGE_TYPES: UsageTypeSignature = {
        "Academic": "b6ac372c-eb4b-497a-9825-3501b17265b2",
        "Maintenance": "3d1cd98b-b664-49b0-b063-179cf3009a90",
        "Meeting": "6802dca4-6858-4085-ab02-1bedb0e9a6b2",
        "Student Activities": "d946c992-97e3-4a44-bb11-07ad0440563d",
    };

    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Attempts to book a slot on UTown FBS. Throws errors if any step fails.
     * 
     * @param startTime e.g. "2024-09-07 18:00:00"
     * @param endTime e.g. "2024-09-07 19:30:00"
     * @param purpose e.g. "Gym Booking - John Doe"
     * @param locationID e.g. 10 (Gym)
     * @param usageType e.g. "Student Activities"
     * @param userCount e.g. 2
     * @param credentials User's FBS credentials
     */
    static async bookSlot(
        startTime: string,
        endTime: string,
        purpose: string,
        locationID: number,
        usageType: string,
        userCount: number,
        doorAccess: boolean,
        aircon: boolean,
        credentials: Credentials
    ): Promise<string | undefined> {
        console.log("Starting booking process...");

        const [date, time] = startTime.split(" ");
        const [_, time_end] = endTime.split(" ");

        if (!date || !time || !time_end) {
            throw new Error("Invalid date/time format for startTime or endTime.");
        }

        const [year, month, day] = date.split("-");
        if (!year || !month || !day) {
            throw new Error("Invalid date format. Expected YYYY-MM-DD.");
        }

        const start_time_form_value = "1800/01/01" + " " + time;
        const end_time_form_value = "1800/01/01" + " " + time_end;

        if (!usageType) {
            throw new Error("Usage Type is not provided");
        }

        const month_parsed = month.replace(/^0+/, '');
        const day_parsed = day.replace(/^0+/, '');

        const venue = FBSInteractor.VENUES[locationID - 1];
        if (!venue) {
            throw new Error("Venue not found for provided locationID.");
        }

        const facil_type_value = venue.facil_type_value;
        const location_value = venue.option_value;
        const usageTypeString = FBSInteractor.USAGE_TYPES[usageType];
        if (!usageTypeString) {
            throw new Error("Invalid usageType provided.");
        }

        let browser: Browser | null = null;
        try {
            console.log("Launching browser...");
            browser = await puppeteer.launch({
                headless: false,
                executablePath: process.env.CHROME_PATH
            });

            console.log("Opening new page...");
            const page = await browser.newPage();
            page.setDefaultTimeout(30000);
            page.setDefaultNavigationTimeout(60000);

            console.log("Navigating to UTown FBS login page...");
            await page.goto("https://utownfbs.nus.edu.sg/utown/loginpage.aspx", {waitUntil: 'networkidle2'});

            console.log("Clicking student login button...");
            await page.waitForSelector('span[id="StudentLoginButton"]', { visible: true });
            await page.click('span[id="StudentLoginButton"]');

            console.log("Logging in...");
            await page.waitForSelector('input[id="userNameInput"]', { visible: true });
            await page.type('input[id="userNameInput"]', credentials.utownfbs_username);
            await page.type('input[id="passwordInput"]', credentials.utownfbs_password);
            await page.click('span[id="submitButton"]');

            console.log("Waiting for page load after login...");
            await FBSInteractor.sleep(20000);

            console.log("Looking for search frame...");
            const frames = page.frames();
            const searchFrame = frames.find(f => f.url().includes('modules/booking/search.aspx'));
            if (!searchFrame) {
                throw new ExpectedElementNotFound("Search Frame not found.");
            }

            console.log("Selecting facility type...");
            const facilTypeSelect = await searchFrame.$('select[name="FacilityType$ctl02"]');
            if (!facilTypeSelect) throw new ExpectedElementNotFound("Facility type dropdown not found.");
            await facilTypeSelect.select(facil_type_value);
            await FBSInteractor.sleep(2000);

            console.log("Selecting specific facility...");
            const facilitySelect = await searchFrame.$('select[name="Facility$ctl02"]');
            if (!facilitySelect) throw new ExpectedElementNotFound("Facility dropdown not found.");
            await facilitySelect.select(location_value);
            await FBSInteractor.sleep(5000);

            console.log("Setting start date...");
            const startDateTable = await searchFrame.$('table[id="StartDate"]');
            if (!startDateTable) throw new ExpectedElementNotFound("Start date table not found.");
            const startDateInput = await startDateTable.$('input[name="StartDate$ctl03"]');
            if (!startDateInput) throw new ExpectedElementNotFound("Start date input not found.");
            await startDateInput.click();
            await searchFrame.waitForSelector('div[id="calendarDiv"]', {visible: true});

            const calendarFrames = searchFrame.childFrames();
            const calendarFrameStart = calendarFrames.find((f: Frame) => f.url().includes('calendar/calendar.htm'));
            if (!calendarFrameStart) throw new ExpectedElementNotFound("Calendar Frame (start) not found.");

            // Select month & year in calendar
            const monthSelectStart = await calendarFrameStart.$('select[id="selectMonth"]');
            const yearSelectStart = await calendarFrameStart.$('select[id="selectYear"]');
            if (!monthSelectStart || !yearSelectStart) {
                throw new ExpectedElementNotFound("Month/Year selects not found in calendar (start).");
            }

            await monthSelectStart.select(month_parsed);
            await yearSelectStart.select(year);

            await calendarFrameStart.waitForSelector('td[id="day7"]', {visible: true});
            await calendarFrameStart.evaluate((day) => {
                const cells = document.querySelectorAll('table.textfont td');
                for (const cell of cells) {
                    if (cell.textContent?.trim() === day) {
                        (cell as HTMLElement).click();
                        break;
                    }
                }
            }, day_parsed);
            await FBSInteractor.sleep(5000);

            console.log("Setting end date...");
            const endDateInput = await startDateTable.$('input[name="StartDate$ctl10"]');
            if (!endDateInput) throw new ExpectedElementNotFound("End date input not found.");
            await endDateInput.click();
            await searchFrame.waitForSelector('div[id="calendarDiv"]', {visible: true});

            const calendarFramesEnd = searchFrame.childFrames();
            const calendarFrameEnd = calendarFramesEnd.find((f: Frame) => f.url().includes('calendar/calendar.htm'));
            if (!calendarFrameEnd) throw new ExpectedElementNotFound("Calendar Frame (end) not found.");

            const monthSelectEnd = await calendarFrameEnd.$('select[id="selectMonth"]');
            const yearSelectEnd = await calendarFrameEnd.$('select[id="selectYear"]');
            if (!monthSelectEnd || !yearSelectEnd) {
                throw new ExpectedElementNotFound("Month/Year selects not found in calendar (end).");
            }

            await monthSelectEnd.select(month_parsed);
            await yearSelectEnd.select(year);

            await calendarFrameEnd.waitForSelector('td[id="day7"]', {visible: true});
            await calendarFrameEnd.evaluate((day) => {
                const cells = document.querySelectorAll('table.textfont td');
                for (const cell of cells) {
                    if (cell.textContent?.trim() === day) {
                        (cell as HTMLElement).click();
                        break;
                    }
                }
            }, day_parsed);
            await FBSInteractor.sleep(3000);

            console.log("Clicking view availability...");
            const viewAvailabilityBtn = await searchFrame.$('input[name="btnViewAvailability"]');
            if (!viewAvailabilityBtn) throw new ExpectedElementNotFound("View Availability button not found.");
            await viewAvailabilityBtn.click();
            await FBSInteractor.sleep(5000);

            console.log("Looking for booking calendar frame...");
            const afterSearchFrames = page.frames();
            const bookingCalFrame = afterSearchFrames.find(f => f.url().includes('BookingCalendar/Default.aspx'));
            if (!bookingCalFrame) throw new ExpectedElementNotFound("Booking Calendar Frame not found.");

            console.log("Looking for available slot...");
            const divAvailString = year + month + day;
            await bookingCalFrame.waitForSelector(`div.divAvailable[id^="${divAvailString}"]`, {visible: true});
            await bookingCalFrame.click(`div.divAvailable[id^="${divAvailString}"]`);

            console.log("Filling booking form...");
            await bookingCalFrame.waitForSelector('div[id="createWindow_c"]', {visible: true});

            // find booking frame inside the createWindow
            const iframeBookingElement = await bookingCalFrame.$('iframe[id="frmCreate"]');
            if (!iframeBookingElement) throw new ExpectedElementNotFound("Booking Frame (iframe) not found.");

            const bookingFrame = await iframeBookingElement.contentFrame();
            if (!bookingFrame) throw new ExpectedElementNotFound("Booking Frame content not accessible.");

            await bookingFrame.waitForNavigation({waitUntil: 'networkidle2'});

            // Fill booking form
            const usageTypeSelect = await bookingFrame.$('select[name="UsageType$ctl02"]');
            if (!usageTypeSelect) throw new ExpectedElementNotFound("Usage Type dropdown not found.");
            await usageTypeSelect.select(usageTypeString);
            await FBSInteractor.sleep(2000);

            const fromSelect = await bookingFrame.$('select[name="from$ctl02"]');
            const toSelect = await bookingFrame.$('select[name="to$ctl02"]');
            if (!fromSelect || !toSelect) throw new ExpectedElementNotFound("Time selection dropdowns not found.");
            await fromSelect.select(start_time_form_value);
            await toSelect.select(end_time_form_value);
            await FBSInteractor.sleep(2000);

            const attendeesInput = await bookingFrame.$('input[name="ExpectedNoAttendees$ctl02"]');
            if (!attendeesInput) throw new ExpectedElementNotFound("ExpectedNoAttendees input not found.");
            await attendeesInput.click({clickCount: 3});
            await attendeesInput.type(userCount.toString());

            const chargeGroupSelect = await bookingFrame.$('select[name="ChargeGroup$ctl02"]');
            if (!chargeGroupSelect) throw new ExpectedElementNotFound("ChargeGroup dropdown not found.");
            await chargeGroupSelect.select('1');

            const purposeTextarea = await bookingFrame.$('textarea[name="Purpose$ctl02"]');
            if (!purposeTextarea) throw new ExpectedElementNotFound("Purpose textarea not found.");
            await purposeTextarea.click({clickCount: 3});
            await purposeTextarea.type(purpose);
            await FBSInteractor.sleep(2000);

            // Handle door access checkbox
            const doorAccessCheckbox = await bookingFrame.$('input[name="DoorAccess$ctl02"]');
            if (!doorAccessCheckbox) throw new ExpectedElementNotFound("Door Access checkbox not found.");
            const isDoorAccessChecked = await doorAccessCheckbox.evaluate(el => (el as HTMLInputElement).checked);
            if (isDoorAccessChecked !== doorAccess) {
                await doorAccessCheckbox.click();
            }

            // Handle aircon checkbox
            const airconCheckbox = await bookingFrame.$('input[name="Aircon$ctl02"]');
            if (!airconCheckbox) throw new ExpectedElementNotFound("Aircon checkbox not found.");
            const isAirconChecked = await airconCheckbox.evaluate(el => (el as HTMLInputElement).checked);
            if (isAirconChecked !== aircon) {
                await airconCheckbox.click();
            }

            await FBSInteractor.sleep(2000);

            console.log("Submitting booking...");
            const createBookingBtn = await bookingFrame.$('input[id="btnCreateBooking"]');
            if (!createBookingBtn) throw new ExpectedElementNotFound("Create Booking button not found.");
            await createBookingBtn.click();
            await FBSInteractor.sleep(15000);

            console.log("Checking for booking errors...");
            const errorMsgElement = await bookingFrame.$('span[id="labelMessage1"]');
            if (errorMsgElement) {
                const errorMessage = await bookingFrame.$eval('#labelMessage1', el => el.textContent?.trim());
                if (errorMessage) {
                    if (errorMessage.includes("Start time must be 30 minutes before currenttime") || errorMessage.includes("End time must be later than start time")) {
                        throw new InvalidBookingTimeException(errorMessage);
                    } else if (errorMessage.includes("The specified slot is booked by another user")) {
                        throw new SlotTakenException(errorMessage);
                    } else {
                        throw new Error("Booking failed: " + errorMessage);
                    }
                } else {
                    throw new Error("Booking failed with an unknown error (no message).");
                }
            }

            console.log("Getting booking reference number...");
            await bookingFrame.waitForSelector('table#BookingReferenceNumber tr td', {visible: true});
            

            const bookingId = await bookingFrame.evaluate(() => {
                const elements = document.querySelectorAll('table#BookingReferenceNumber tr td');
                return elements[1]?.textContent?.trim() || undefined;
            });

            if (!bookingId) {
                throw new Error("No booking reference number found, booking might have failed silently.");
            }
            
            console.log(`Booking completed successfully with reference number: ${bookingId}`);
            // Take a screenshot of the confirmation page
            console.log("Saving confirmation screenshot...");
            const screenshotPath = `booking-confirmation-${Date.now()}.png`;
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            });
            console.log(`Screenshot saved as ${screenshotPath}`);
            return bookingId;

        } catch (error: any) {
            console.error("Booking process failed at stage:", error);
            throw error;
        } finally {
            if (browser) {
                console.log("Closing browser...");
                await browser.close();
            }
        }
    }
}

export class InvalidBookingTimeException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidBookingTimeException";
    }
} 

export class SlotTakenException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SlotTakenException";
    }
}

export class ExpectedElementNotFound extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ExpectedElementNotFound";
    }
}

export default FBSInteractor;

// Usage Example:
// (async () => {
//     try {
//         const bookingRef = await FBSInteractor.bookSlot(
//             "2024-09-07 18:00:00",
//             "2024-09-07 19:30:00",
//             "Gym Booking - Test User",
//             10,
//             "Student Activities",
//             2,
//             true,   // doorAccess
//             false, // aircon
//             credentials,
//         );
//         console.log("Booking reference:", bookingRef);
//     } catch (e) {
//         console.error("Failed to book:", e);
//     }
// })();
