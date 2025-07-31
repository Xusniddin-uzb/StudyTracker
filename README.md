# Engineering Diary Telegram Bot

A Telegram bot to help track your daily engineering progress and stay sharp with AI-powered weekly quizzes.

## Features

-   **Daily Logs**: Quickly save what you worked on, what you learned, and any blockers.
-   **AI-Powered Weekly Reviews**: Get an automatic summary of your week's logs.
-   **AI-Powered Quizzes**: Test your knowledge with multiple-choice questions based on what you learned.
-   **Customizable Quiz Schedule**: Choose the day and time you receive your weekly review.

## Setup

### 1. Prerequisites

-   Node.js (v18 or newer)
-   A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
-   A Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey)
-   A PostgreSQL database (Railway, Render, or any other provider)

### 2. Installation

1.  Clone the repository:
    ```bash
    git clone <your-repo-url>
    cd engineering-diary-bot
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Create a `.env` file by copying the `.env.example` file:
    ```bash
    cp .env.example .env
    ```

4.  Edit the `.env` file and add your secret keys and database URL.

### 3. Running Locally

```bash
npm start
```

### 4. Deploying to Railway

1.  Push your code to a GitHub repository.
2.  Create a **New Project** on Railway and select **Deploy from GitHub repo**.
3.  Add a **PostgreSQL** database service to your project.
4.  In your bot's service settings, go to the **Variables** tab and add your `TELEGRAM_API_TOKEN` and `OPENROUTER_API_KEY`. The `DATABASE_URL` will be injected automatically.