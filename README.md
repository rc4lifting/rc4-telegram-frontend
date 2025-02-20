## Prerequisites

Before you begin, ensure you have met the following requirements:

* You have installed [Bun](https://bun.sh) (latest version)
* You have a Telegram account and have created a bot using [BotFather](https://core.telegram.org/bots#6-botfather)
* You have [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed (for containerized deployment)

## Setting up the project

To set up the project, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/your-repo-name.git
   cd your-repo-name
   ```

2. Install the dependencies:
   ```bash
   bun install
   ```

3. Set up environment files:
   
   Create environment files for both development and production:
   ```bash
   secrets/dev/.env    # Development environment variables
   secrets/prod/.env   # Production environment variables
   ```

   Each .env file should contain:
   ```
   BOT_TOKEN=your_bot_token_here
   UTOWNFBS_USERNAME=your_username
   UTOWNFBS_PASSWORD=your_password
   API_BASE_URL=your_api_url_here
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your_email
   GOOGLE_PRIVATE_KEY=your_private_key
   GOOGLE_SHEETS_ID=your_sheets_id
   TELEGRAM_SERVICE_ACCOUNT_ID=your_service_account_id
   TELEGRAM_SERVICE_ACCOUNT_USERNAME=your_service_account_username
   TIMESHEET_URL=your_timesheet_url
   ```

   Note: The secrets directory is gitignored to prevent accidental commits of sensitive data.

## Running the bot

### Development Mode

To run the bot locally with Bun:

```bash
bun src/bot.ts
```

### Docker Deployment

The project uses environment-specific configurations. You can run either development or production environments:

1. Development environment:
   ```bash
   ENV=dev docker compose up
   ```

2. Production environment:
   ```bash
   ENV=prod docker compose up
   ```

To run in detached mode, add the -d flag:
```bash
ENV=prod docker compose up -d
```

The Docker setup includes:
- Host network mode for direct network access
- Environment-specific configurations via secrets/dev/.env or secrets/prod/.env
- Chromium for Puppeteer support

To stop the bot:
```bash
docker compose down
```

## Project Structure

- `src/bot.ts`: The main file containing the bot logic
- `src/services/`: Service layer for various functionalities
- `package.json`: Project configuration and dependencies
- `tsconfig.json`: TypeScript configuration
- `docker-compose.yml`: Docker Compose configuration
- `