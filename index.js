require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');
const ai = require('./ai');

const token = process.env.TELEGRAM_API_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_API_TOKEN is not defined in your environment variables.");
    process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

// In-memory state management for multi-step conversations
const userStates = {};

// --- Command Handlers ---

bot.onText(/\/start|\/help/, (msg) => {
    const chatId = msg.chat.id;
    db.findOrCreateUser(chatId);
    const helpText = `
👋 *Welcome to your Engineering Diary Bot!*

This bot helps you track your progress and stay sharp. Here's how to get started:

*/log* - Add a new daily log. I'll ask you three simple questions.
*/quiztime* - Set a weekly day and time for an AI-powered quiz based on your logs.
*/help* - Show this message again.

Start by adding your first entry with /log!
    `;
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/log/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { command: 'log', step: 1, data: {} };
    bot.sendMessage(chatId, "Great! Let's log your day.\n\n*What did you work on today?*", { parse_mode: 'Markdown' });
});

bot.onText(/\/quiztime/, (msg) => {
    const chatId = msg.chat.id;
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Sun', callback_data: 'quizday_0' }, { text: 'Mon', callback_data: 'quizday_1' }, { text: 'Tue', callback_data: 'quizday_2' }],
                [{ text: 'Wed', callback_data: 'quizday_3' }, { text: 'Thu', callback_data: 'quizday_4' }, { text: 'Fri', callback_data: 'quizday_5' }],
                [{ text: 'Sat', callback_data: 'quizday_6' }]
            ]
        }
    };
    bot.sendMessage(chatId, "Pick a day for your weekly review quiz:", options);
});


// --- Handle Callbacks (from Inline Keyboards) ---

bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    if (data.startsWith('quizday_')) {
        const day = parseInt(data.split('_')[1]);
        userStates[chatId] = { command: 'quiztime', step: 1, data: { day } };
        bot.editMessageText("Great! Now, please reply with the quiz time (using a 24-hour format, 0-23). For example, enter `20` for 8 PM.", {
            chat_id: chatId,
            message_id: msg.message_id
        });
    }
    bot.answerCallbackQuery(callbackQuery.id);
});


// --- Handle All Other Messages (Conversations) ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands and non-text messages
    if (!userStates[chatId] || (text && text.startsWith('/'))) {
        return;
    }

    const state = userStates[chatId];

    if (state.command === 'log') {
        if (state.step === 1) {
            state.data.work = text;
            state.step = 2;
            bot.sendMessage(chatId, "*What new thing did you learn?*", { parse_mode: 'Markdown' });
        } else if (state.step === 2) {
            state.data.learn = text;
            state.step = 3;
            bot.sendMessage(chatId, "*Did you have any blockers?* (Type 'none' if not)", { parse_mode: 'Markdown' });
        } else if (state.step === 3) {
            state.data.blockers = text;
            // Save the log to the database
            await db.addLog(chatId, state.data);
            bot.sendMessage(chatId, "✅ Log entry saved successfully!");
            
            // Add fast AI-powered encouragement
            try {
                const thinkingMessage = await bot.sendMessage(chatId, "🤖...");
                const encouragement = await ai.generateEncouragement(msg.from.first_name, state.data.learn);
                bot.editMessageText(encouragement, {
                    chat_id: chatId,
                    message_id: thinkingMessage.message_id
                });
            } catch(e) {
                console.error("Could not generate encouragement message:", e);
            }

            delete userStates[chatId]; // End conversation
        }
    }

    if (state.command === 'quiztime') {
        const time = parseInt(text);
        if (!isNaN(time) && time >= 0 && time <= 23) {
            await db.setQuizTime(chatId, state.data.day, time);
            const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            bot.sendMessage(chatId, `✅ All set! Your weekly quiz will arrive every *${dayNames[state.data.day]} at ${time}:00*.`, { parse_mode: 'Markdown' });
            delete userStates[chatId];
        } else {
            bot.sendMessage(chatId, "⚠️ That's not a valid hour. Please enter a single number between 0 and 23.");
        }
    }
});

// --- Scheduled Job & Error Handling ---

cron.schedule('0 * * * *', async () => {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();

    const users = await db.getAllUsers();
    for (const user of users) {
        if (user.quiz_day === currentDay && user.quiz_time === currentHour) {
            console.log(`[${now.toISOString()}] Triggering quiz for user ${user.chat_id}`);
            const logs = await db.getWeeklyLogs(user.chat_id);
            const reviewText = await ai.generateWeeklyReview(logs);
            bot.sendMessage(user.chat_id, reviewText, { parse_mode: 'Markdown' });
        }
    }
});

bot.on('polling_error', (error) => console.error(`[Polling Error] ${error.code}: ${error.message}`));
bot.on('webhook_error', (error) => console.error(`[Webhook Error] ${error.code}: ${error.message}`));

console.log("🚀 Engineering Diary Bot is running...");