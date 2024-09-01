import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

const UTOWNFBS_USERNAME: string = process.env.UTOWNFBS_USERNAME as string;
const UTOWNFBS_PASSWORD: string = process.env.UTOWNFBS_PASSWORD as string;

interface UsageTypeSignature {
    [key: string]: string;
}

class FBSInteractor {

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
    
    static async bookSlot(startTime: string, endTime: string, purpose: string, locationID: number, usageType: string, userCount: number) {

        // example call: 
        // await FBSInteractor.bookSlot("2024-09-07 18:00:00", "2024-09-07 19:30:00", "Gym Booking - Benjamin Seow", 10, "Student Activities", 2);

        // date formating
        // start_time: "2023-05-02 14:00:00"
        // end_time: "2023-05-02 16:00:00"
        const [date, time] = startTime.split(" ");
        const [date_end, time_end] = endTime.split(" ");

        if (date == null) {
            throw new Error("Date is null");
        }

        const [year, month, day] = date.split("-");

        // start and end time formatting
        const start_time_form_value = "1800/01/01" + " " + time;
        const end_time_form_value = "1800/01/01" + " " + time_end;

        if (year == null || month == null || day == null) {
            throw new Error("Date Parts is null");
        }

        const month_parsed = month.replace(/^0+/, '');
        const day_parsed = day.replace(/^0+/, '');

        // booking automation
        try {
            console.log("web booking started");
            const browser = await puppeteer.launch({browser: 'chrome', headless: false});
            const page = await browser.newPage();
            console.log("browser has been set up");

            await page.goto("https://utownfbs.nus.edu.sg/utown/loginpage.aspx");

            // Login
            await page.locator('span[id="StudentLoginButton"]').click();

            await page.waitForNavigation({waitUntil: 'load'});
            await page.waitForSelector('input[id="userNameInput"]');
            await page.locator('input[id="userNameInput"]').fill(UTOWNFBS_USERNAME);
            await page.locator('input[id="passwordInput"]').fill(UTOWNFBS_PASSWORD);
            await page.locator('span[id="submitButton"]').click();
            await FBSInteractor.sleep(20000); // wait for page to fully load!
            console.log("logged into utownfbs")

            // find search frame 
            const frames = page.frames();
            const searchFrame = frames.find(f => f.url() == 'https://utownfbs.nus.edu.sg/utown/modules/booking/search.aspx');
            
            if (searchFrame == null) {
                throw new Error("Search Frame not found");
            }

            // fill up search frame with location, startdate, enddate + search
            const facil_type_value = FBSInteractor.VENUES[locationID - 1]?.facil_type_value as string || "null";
            const location_value = FBSInteractor.VENUES[locationID - 1]?.option_value as string || "null";
            await searchFrame.$('select[name="FacilityType$ctl02"]').then(eh => eh?.select(facil_type_value)); // facil type
            await searchFrame.$('select[name="Facility$ctl02"]').then(eh => eh?.select(location_value)); // facilities
            await FBSInteractor.sleep(5000); // wait for form to fully load, so that start date change is stable

            // start date
            (await (await searchFrame.$('table[id="StartDate"]'))?.$('input[name="StartDate$ctl03"]'))?.click(); 

            await searchFrame.waitForSelector('div[id="calendarDiv"]', {visible: true});
            
            const calenderFrame = searchFrame.childFrames().find(f => f.url() == 'https://utownfbs.nus.edu.sg/utown/calendar/calendar.htm');
            if (calenderFrame == null) {
                throw new Error("Calender Frame not found");
            }

            await calenderFrame.$('select[id="selectMonth"]').then(eh => eh?.select(month_parsed)); // select month 1, 2, 3, 4, 5, ...
            await calenderFrame.waitForSelector('td[id="day7"]');

            await calenderFrame.$('select[id="selectYear"]').then(eh => eh?.select(year)); // select year 2024, 2025, ...
            await calenderFrame.waitForSelector('td[id="day7"]');

            (await calenderFrame.$(`::-p-xpath(//table[@class="textfont"]//td[normalize-space(text())="${day_parsed}"])`))?.click(); // select day 1, 2, 3, 4, 5, ...
            await FBSInteractor.sleep(5000); // wait for end date to load after start date is changed

            // end date
            (await (await searchFrame.$('table[id="StartDate"]'))?.$('input[name="StartDate$ctl10"]'))?.click(); 

            await searchFrame.waitForSelector('div[id="calendarDiv"]', {visible: true});
            
            const calenderFrameEnd = searchFrame.childFrames().find(f => f.url() == 'https://utownfbs.nus.edu.sg/utown/calendar/calendar.htm');
            if (calenderFrameEnd == null) {
                throw new Error("Calender Frame not found");
            }

            await calenderFrameEnd.$('select[id="selectMonth"]').then(eh => eh?.select(month_parsed)); // select month 1, 2, 3, 4, 5, ...
            await calenderFrameEnd.waitForSelector('td[id="day7"]');

            await calenderFrameEnd.$('select[id="selectYear"]').then(eh => eh?.select(year)); // select year 2024, 2025, ...
            await calenderFrameEnd.waitForSelector('td[id="day7"]');

            (await calenderFrameEnd.$(`::-p-xpath(//table[@class="textfont"]//td[normalize-space(text())="${day_parsed}"])`))?.click(); // select day 1, 2, 3, 4, 5, ...
            await FBSInteractor.sleep(3000); // wait for end date value to fully load!

            await searchFrame.locator('input[name="btnViewAvailability"]').click();
            await FBSInteractor.sleep(5000); // wait for page to fully load!
            console.log("searched for available slots");
            
            // find search frame 
            const aftersearch_frames = page.frames();
            const bookingCalFrame = aftersearch_frames.find(f => f.url() == 'https://utownfbs.nus.edu.sg/utown/modules/BookingCalendar/Default.aspx');
            
            if (bookingCalFrame == null) {
                throw new Error("Booking Calender Frame not found");
            }

            // find divAvailiable and click
            const divAvailString = year + month + day;
            await bookingCalFrame.locator(`div.divAvailable[id^="${divAvailString}"]`).click();
            await bookingCalFrame.waitForSelector('div[id="createWindow_c"]', {visible: true});

            // find booking frame 
            const iframeBookingElement = await bookingCalFrame.$('iframe[id="frmCreate"]');

            if (iframeBookingElement == null) {
                throw new Error("Booking Frame not found");
            }

            const bookingFrame = await iframeBookingElement.contentFrame();

            console.log("found booking frame");
            await bookingFrame.waitForNavigation({waitUntil: 'load'});

            // fill up booking frame with name, startTime, endTime, usageType, chargeGroup, numAttendees, purpose
            const usageTypeValue = FBSInteractor.USAGE_TYPES[usageType] || "null";
            await bookingFrame.$('select[name="UsageType$ctl02"]').then(eh => eh?.select(usageTypeValue)); //usageType selecting
            await FBSInteractor.sleep(2000); // wait for form to fully load!
            await bookingFrame.$('select[name="from$ctl02"]').then(eh => eh?.select(start_time_form_value)); // select start time 1800/01/01 ...
            await bookingFrame.$('select[name="to$ctl02"]').then(eh => eh?.select(end_time_form_value)); // select end time 1800/01/01 ...
            await bookingFrame.locator('input[name="ExpectedNoAttendees$ctl02"]').fill(userCount.toString());
            await bookingFrame.$('select[name="ChargeGroup$ctl02"]').then(eh => eh?.select('1'));
            await bookingFrame.locator('textarea[name="Purpose$ctl02"]').fill(purpose);

            // submit booking frame
            await bookingFrame.locator('input[id="btnCreateBooking"]').click()
            await bookingFrame.waitForNavigation({waitUntil: 'load'});
            console.log("booking submitted");
            await FBSInteractor.sleep(10000); // wait for elements to be fully loaded!
            
            // anticipate for error message or new booking reference number
            const errorMsgElement = await bookingFrame.$('span[id="labelMessage1"]');

            if (errorMsgElement) {
                const errorMessage = await bookingFrame.$eval(
                    "#labelMessage1",
                    (el) => el.textContent?.trim()
                );

                if (errorMessage == "Start time must be 30 minutes before currenttime") {
                    throw new Error(
                        errorMessage ? errorMessage : "Booking failed (null message)"
                    );
                } 

                throw new Error(errorMessage ? errorMessage : "Booking failed (null message)");
            }
        
            await browser.close();

        } catch (error) {
            console.log("error: ", error);
            throw error;
        }
    }
}

export default FBSInteractor;