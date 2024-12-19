import os
import json
import re
import asyncio
from datetime import datetime
from io import BytesIO
import logging
from logging.handlers import RotatingFileHandler

from playwright.async_api import async_playwright
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, CommandHandler, filters
from dotenv import load_dotenv

load_dotenv()

# Add after imports
# Configure logging
log_directory = "logs"
if not os.path.exists(log_directory):
	os.makedirs(log_directory)

logger = logging.getLogger("FBSBot")
logger.setLevel(logging.DEBUG)

# File handler with rotation
file_handler = RotatingFileHandler(
	os.path.join(log_directory, "fbsbot.log"),
	maxBytes=1024 * 1024,  # 1MB
	backupCount=5
)
file_handler.setFormatter(
	logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
)
logger.addHandler(file_handler)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(
	logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
)
logger.addHandler(console_handler)

# Load credentials
with open("credentials.json", "r") as f:
	creds_data = json.load(f)

AUTHORIZED_USERS = {
	user["telegram_id"]: {
		"utownfbs_username": user["utownfbs_username"],
		"utownfbs_password": user["utownfbs_password"]
	} for user in creds_data.get("users", [])
}

VENUE_MAP = {
	"SR1": 1, "SR2": 2, "SR3": 3, "SR4": 4, "SR5": 5,
	"TR1": 6, "TR2": 7, "TR3": 8, "TR4": 9,
	"Gym": 10, "MPSH": 11
}

USAGE_TYPE = "Student Activities"
USER_COUNT = 2
TIMEZONE = os.environ.get("TIMEZONE", "Asia/Singapore")

BOOKING_REGEX = re.compile(
	r"^book\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$",
	re.IGNORECASE
)

class InvalidBookingTimeException(Exception):
	pass

class SlotTakenException(Exception):
	pass

class ExpectedElementNotFound(Exception):
	pass

class FBSInteractor:
	VENUES = [
		{ "id": 1, "name": "SR1", "desc": "Seminar Room 1", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "4ada4203-06ab-48ac-8a14-1bb8c26474e2"},
		{ "id": 2, "name": "SR2", "desc": "Seminar Room 2", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "c353d4b6-dff1-4006-a4db-d7fa49659ffc"},
		{ "id": 3, "name": "SR3", "desc": "Seminar Room 3", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "c9c6f9d5-9b42-4978-aed1-a1b86af20365"},
		{ "id": 4, "name": "SR4", "desc": "Seminar Room 4", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "e0568195-98af-403c-b3cf-0350e443e403"},
		{ "id": 5, "name": "SR5", "desc": "Seminar Room 5", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "8f070a07-7ab2-4194-b841-f53304e7f2a6"},
		{ "id": 6, "name": "TR1", "desc": "Theme Room 1", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "c27c5808-e80d-4f1c-9982-aca83c359001"},
		{ "id": 7, "name": "TR2", "desc": "Theme Room 2", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "3fa27ba4-9a0b-41f3-9282-15f78943994b"},
		{ "id": 8, "name": "TR3", "desc": "Theme Room 3", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "635ed65a-1db0-4201-a40c-77df9ff8e7d8"},
		{ "id": 9, "name": "TR4", "desc": "Theme Room 4" , "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "8839f7ab-1a73-4190-b4aa-84e1e6524187"},
		{ "id": 10, "name": "Gym", "desc": "Gym", "facil_type_value": "b0b1df78-0e74-4b3c-8033-ced5e3e32413", "option_value": "32ecb2ef-0600-44b9-97b0-dbf2a1c2bfab" },
		{ "id": 11, "name": "MPSH", "desc": "Multi-purpose sports hall", "facil_type_value": "775b9829-d80e-4191-bebb-a9219b9c3d10", "option_value": "c79604f1-8481-4ca1-be2a-17e273348b21" }
	]

	USAGE_TYPES = {
		"Academic": "b6ac372c-eb4b-497a-9825-3501b17265b2",
		"Maintenance": "3d1cd98b-b664-49b0-b063-179cf3009a90",
		"Meeting": "6802dca4-6858-4085-ab02-1bedb0e9a6b2",
		"Student Activities": "d946c992-97e3-4a44-bb11-07ad0440563d",
	}

	@staticmethod
	async def book_slot(
		startTime: str,
		endTime: str,
		purpose: str,
		locationID: int,
		usageType: str,
		userCount: int,
		credentials: dict
	) -> (str, BytesIO):
		logger.info(f"Starting booking process for venue {locationID} from {startTime} to {endTime}")

		# Parse dates
		dt_format = "%Y-%m-%d %H:%M:%S"
		try:
			start_dt = datetime.strptime(startTime, dt_format)
			end_dt = datetime.strptime(endTime, dt_format)
		except ValueError:
			logger.error(f"Invalid datetime format: startTime={startTime}, endTime={endTime}")
			raise ValueError("Invalid datetime format for startTime/endTime")

		venue = next((v for v in FBSInteractor.VENUES if v["id"] == locationID), None)
		if not venue:
			logger.error(f"Invalid venue ID: {locationID}")
			raise ValueError("Venue not found")

		logger.debug(f"Processing booking for {venue['name']} ({venue['desc']})")

		date = start_dt.strftime("%Y-%m-%d")
		time = start_dt.strftime("%H:%M:%S")
		time_end = end_dt.strftime("%H:%M:%S")

		year, month, day = date.split("-")
		month_parsed = str(int(month))
		day_parsed = str(int(day))

		facil_type_value = venue["facil_type_value"]
		location_value = venue["option_value"]
		usageTypeString = FBSInteractor.USAGE_TYPES.get(usageType)
		if not usageTypeString:
			raise ValueError("Invalid usageType")

		start_time_form_value = "1800/01/01 " + time
		end_time_form_value = "1800/01/01 " + time_end

		async with async_playwright() as p:
			browser = await p.chromium.launch(headless=False)
			page = await browser.new_page()

			try:
				logger.info("Navigating to login page")
				await page.goto("https://utownfbs.nus.edu.sg/utown/loginpage.aspx")
				await page.locator('span[id="StudentLoginButton"]').click()
				
				logger.debug("Attempting login")
				await page.locator('input[id="userNameInput"]').fill(credentials["utownfbs_username"])
				await page.locator('input[id="passwordInput"]').fill(credentials["utownfbs_password"])  # Masked for logging
				await page.locator('span[id="submitButton"]').click()

				logger.debug("Waiting for login completion")
				await page.wait_for_timeout(20000)

				# Find search frame
				search_frame = None
				for f in page.frames:
					if "modules/booking/search.aspx" in f.url:
						search_frame = f
						break
				if not search_frame:
					logger.error("Search frame not found in page")
					raise ExpectedElementNotFound("Search Frame not found")

				logger.debug("Selecting facility and location")
				await search_frame.locator('select[name="FacilityType$ctl02"]').select_option(facil_type_value)
				await asyncio.sleep(2)
				await search_frame.locator('select[name="Facility$ctl02"]').select_option(location_value)
				await asyncio.sleep(5)

				# Set Start Date
				logger.debug("Setting start date")
				await search_frame.locator('table[id="StartDate"] input[name="StartDate$ctl03"]').click()
				await asyncio.sleep(2)

				calendar_frame_start = None
				for cf in search_frame.child_frames:
					if "calendar/calendar.htm" in cf.url:
						calendar_frame_start = cf
						break
				if not calendar_frame_start:
					logger.error("Start Calendar Frame not found")
					raise ExpectedElementNotFound("Start Calendar Frame not found")

				await calendar_frame_start.locator('select#selectMonth').select_option(month_parsed)
				await calendar_frame_start.locator('select#selectYear').select_option(year)
				await calendar_frame_start.locator(f'td:text-is("{day_parsed}")').click()
				await asyncio.sleep(5)

				# Set End Date
				logger.debug("Setting end date")
				await search_frame.locator('table[id="StartDate"] input[name="StartDate$ctl10"]').click()
				await asyncio.sleep(2)

				
				calendar_frame_end = None
				for cf in search_frame.child_frames:
					if "calendar/calendar.htm" in cf.url:
							calendar_frame_end = cf
							break
				if not calendar_frame_end:
					logger.error("End Calendar Frame not found")
					raise ExpectedElementNotFound("End Calendar Frame not found")

				await calendar_frame_end.locator('select#selectMonth').select_option(month_parsed)
				await calendar_frame_end.locator('select#selectYear').select_option(year)
				await calendar_frame_end.locator(f'td:text-is("{day_parsed}")').click()
				await asyncio.sleep(3)

				logger.debug("Viewing availability")
				await search_frame.locator('input[name="btnViewAvailability"]').click()
				await asyncio.sleep(5)

				bookingCalFrame = None
				for f in page.frames:
					if "BookingCalendar/Default.aspx" in f.url:
						bookingCalFrame = f
						break
				if not bookingCalFrame:
					logger.error("Booking Calendar Frame not found")
					raise ExpectedElementNotFound("Booking Calendar Frame not found")

				divAvailString = year + month + day
				await bookingCalFrame.locator(f'div.divAvailable[id^="{divAvailString}"]').click()
				await asyncio.sleep(2)

				logger.debug("Accessing booking form")
				await bookingCalFrame.wait_for_selector('iframe[id="frmCreate"]')
				frmCreate = await bookingCalFrame.locator('iframe[id="frmCreate"]').element_handle()
				booking_frame = await frmCreate.content_frame()
				if not booking_frame:
					logger.error("Booking Frame not accessible")
					raise ExpectedElementNotFound("Booking Frame not accessible")

				logger.debug("Filling booking form")
				await booking_frame.locator('select[name="UsageType$ctl02"]').select_option(usageTypeString)
				await asyncio.sleep(2)

				await booking_frame.locator('select[name="from$ctl02"]').select_option(start_time_form_value)
				await booking_frame.locator('select[name="to$ctl02"]').select_option(end_time_form_value)
				await asyncio.sleep(2)

				attendees_input = booking_frame.locator('input[name="ExpectedNoAttendees$ctl02"]')
				await attendees_input.click()
				await attendees_input.fill(str(userCount))

				await booking_frame.locator('select[name="ChargeGroup$ctl02"]').select_option('1')
				purpose_textarea = booking_frame.locator('textarea[name="Purpose$ctl02"]')
				await purpose_textarea.click()
				await purpose_textarea.fill(purpose)
				await asyncio.sleep(2)

				logger.debug("Submitting booking form")
				await booking_frame.locator('input[id="btnCreateBooking"]').click()
				await asyncio.sleep(15)

				if await booking_frame.locator('#labelMessage1').count() > 0:
					errorMessage = (await booking_frame.locator('#labelMessage1').inner_text()).strip()
					logger.warning(f"Booking form returned error: {errorMessage}")
					if "Start time must" in errorMessage or "End time must" in errorMessage:
						raise InvalidBookingTimeException(errorMessage)
					elif "booked by another user" in errorMessage:
						raise SlotTakenException(errorMessage)
					else:
						raise Exception("Booking failed: " + errorMessage)

				await booking_frame.wait_for_selector('table#BookingReferenceNumber tr td')
				booking_id_elements = await booking_frame.locator('table#BookingReferenceNumber tr td').all_inner_texts()
				if len(booking_id_elements) < 2:
					logger.error("Booking reference number not found in response")
					raise Exception("No booking reference number found.")
				
				booking_id = booking_id_elements[1].strip()
				logger.info(f"Booking successful. Reference number: {booking_id}")

				screenshot_bytes = await page.screenshot(full_page=True)
				screenshot_io = BytesIO(screenshot_bytes)

				return booking_id, screenshot_io

			except Exception as e:
				logger.error(f"Error during booking process: {str(e)}", exc_info=True)
				raise
			finally:
				logger.debug("Closing browser")
				await browser.close()


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
	await update.message.reply_text(
		"Hello! To book, send a message like:\n\n"
		"`book SR1 2024-12-25 10:00 to 2024-12-25 12:00`",
		parse_mode="Markdown"
	)

async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
	# user_id = 346436282
	user_id = update.effective_user.id
	username = update.effective_user.username or 'Unknown user'
	logger.info(f"Received message from user {username} (ID: {user_id}): {update.message.text}")

	if user_id not in AUTHORIZED_USERS:
		logger.warning(f"Unauthorized access attempt from user {username} (ID: {user_id})")
		await update.message.reply_text("❌ You are not authorized to use this bot.")
		return

	message = update.message.text.strip()
	m = BOOKING_REGEX.match(message)
	if not m:
		await update.message.reply_text(
			"❌ Invalid format. Use:\n"
			"`book VENUE YYYY-MM-DD HH:mm to YYYY-MM-DD HH:mm`\n\n"
			"Example:\n"
			"`book SR1 2024-01-25 14:00 to 2024-01-25 16:00`\n\n"
			"Available venues: SR1, SR2, SR3, SR4, SR5, TR1, TR2, TR3, TR4, Gym, MPSH",
			parse_mode="Markdown"
		)
		return

	venueName, startDateStr, startTimeStr, endDateStr, endTimeStr = m.groups()
	venueId = VENUE_MAP.get(venueName)
	if not venueId:
		await update.message.reply_text(f"❌ Unknown venue: {venueName}. Please try again.")
		return

	# Validate dates
	try:
		start_dt = datetime.strptime(f"{startDateStr} {startTimeStr}", "%Y-%m-%d %H:%M")
		end_dt = datetime.strptime(f"{endDateStr} {endTimeStr}", "%Y-%m-%d %H:%M")
	except ValueError:
		await update.message.reply_text("❌ Invalid date/time format.")
		return

	if end_dt <= start_dt:
		await update.message.reply_text("❌ End time must be after start time.")
		return

	now = datetime.now()
	if end_dt <= now:
		await update.message.reply_text("❌ Booking must be in the future.")
		return

	await update.message.reply_text("Processing your booking request. Please wait...")

	purpose = f"Telegram booking by {update.effective_user.username or 'Unknown user'}"
	user_creds = AUTHORIZED_USERS[user_id]
	logger.info(f"{user_creds}")

	startStr = start_dt.strftime("%Y-%m-%d %H:%M:%S")
	endStr = end_dt.strftime("%Y-%m-%d %H:%M:%S")

	try:
		bookingRef, screenshot_io = await FBSInteractor.book_slot(
			startStr,
			endStr,
			purpose,
			venueId,
			USAGE_TYPE,
			USER_COUNT,
			user_creds
		)
		logger.info(f"Booking successful for user {username}. Reference: {bookingRef}")

		await update.message.reply_photo(
			photo=screenshot_io,
			caption=f"✅ Booking confirmed!\nReference: {bookingRef}"
		)
	except SlotTakenException:
		logger.warning(f"Booking failed for user {username}: Slot already taken")
		await update.message.reply_text("❌ The selected slot is already taken. Please choose another time.")
	except InvalidBookingTimeException as e:
		logger.warning(f"Booking failed for user {username}: Invalid booking time - {str(e)}")
		await update.message.reply_text(f"❌ Invalid booking time: {str(e)}")
	except Exception as e:
		logger.error(f"Booking failed for user {username}: {str(e)}", exc_info=True)
		await update.message.reply_text(f"❌ {str(e)}")

async def main():
	logger.info("Starting FBS Bot")
	token = os.environ.get("FBS_BOT_TOKEN")
	if not token:
		logger.critical("FBS_BOT_TOKEN environment variable is not set")
		raise ValueError("FBS_BOT_TOKEN environment variable is not set. Please set it with your bot token from BotFather.")
	
	application = ApplicationBuilder().token(token).build()

	application.add_handler(CommandHandler("start", start_command))
	application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

	# Start the bot without using run_polling
	await application.initialize()
	await application.start()
	await application.updater.start_polling()

	# Keep the bot running until interrupted
	try:
		while True:
			await asyncio.sleep(1)
	except Exception as e:
		logger.error("Bot encountered an error", exc_info=True)
	finally:
		logger.info("Shutting down bot")
		await application.updater.stop()
		await application.stop()
		await application.shutdown()

if __name__ == "__main__":
	try:
		asyncio.run(main())
	except KeyboardInterrupt:
		print("Bot stopped by user")
