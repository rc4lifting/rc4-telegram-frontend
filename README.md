## Prerequisites

Before you begin, ensure you have met the following requirements:

* You have installed [Bun](https://bun.sh) (latest version)
* You have a Telegram account and have created a bot using [BotFather](https://core.telegram.org/bots#6-botfather)

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

3. Create a `.env` file in the root directory and add your bot token:
   ```
   BOT_TOKEN=your_bot_token_here
   API_BASE_URL=your_api_url_here
   ```

## Running the bot

To run the bot in development mode with hot reloading:

```
npm run dev
```

This will start the bot using `nodemon`, which will automatically restart the bot when you make changes to the code.

To build the production version of your bot:

```
npm run build
```

This will compile your TypeScript code into JavaScript in the `dist` directory.

To start the bot in production mode:

```
npm start
```

## Project Structure

- `src/bot.ts`: The main file containing the bot logic
- `package.json`: Project configuration and dependencies
- `tsconfig.json`: TypeScript configuration
- `.env`: Environment variables (make sure to keep this file private)
- `.gitignore`: Specifies which files Git should ignore