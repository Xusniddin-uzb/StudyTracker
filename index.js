require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');
const ai = require('./ai');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

// Added new libraries for PDF generation and Markdown conversion
const puppeteer = require('puppeteer');
const { marked } = require('marked');

const token = process.env.TELEGRAM_API_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_API_TOKEN is not defined.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.setMyCommands([
    { command: 'start', description: '🚀 Start/Help - Get started with learning diary' },
    { command: 'learn', description: '📚 Log what you learned today' },
    { command: 'quick', description: '⚡ Quick learning entry' },
    { command: 'view', description: '👀 View your learning history' },
    { command: 'search', description: '🔍 Search your past learnings' },
    { command: 'stats', description: '📊 See your learning statistics' },
    { command: 'goals', description: '🎯 Set daily learning goals' },
    { command: 'quiz', description: '🧠 Test your knowledge' },
    { command: 'summarize', description: '📝 Get weekly summary' },
    { command: 'export', description: '📤 Export your learnings' }
]);

const userStates = {};
const userSettings = {};

const formatLearnings = (learnings) => {
    if (!learnings.length) return "📭 No entries found for this period.";
    return learnings.map((l, index) => {
        const date = format(new Date(l.createdAt), 'MMM dd, HH:mm');
        const category = l.category ? `[${l.category}] ` : '';
        return `${index + 1}. ${category}${l.content}\n   ⏰ ${date}`;
    }).join('\n\n');
};

const getMainMenuKeyboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: '📚 Quick Learn', callback_data: 'quick_learn' }, { text: '👀 View Today', callback_data: 'view_today' }],
            [{ text: '📊 My Stats', callback_data: 'show_stats' }, { text: '🎯 Goals', callback_data: 'manage_goals' }],
            [{ text: '🧠 Take Quiz', callback_data: 'start_quiz' }, { text: '🔍 Search', callback_data: 'start_search' }]
        ]
    }
});

const getViewOptionsKeyboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: '📅 Today', callback_data: 'view_today' }, { text: '📅 Yesterday', callback_data: 'view_yesterday' }],
            [{ text: '📅 This Week', callback_data: 'view_week' }, { text: '📅 This Month', callback_data: 'view_month' }],
            [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
        ]
    }
});

const getLearningCategories = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: '💻 Tech/Programming', callback_data: 'cat_tech' }, { text: '🔬 Science', callback_data: 'cat_science' }],
            [{ text: '🎨 Creative/Art', callback_data: 'cat_creative' }, { text: '📖 Language', callback_data: 'cat_language' }],
            [{ text: '💼 Business', callback_data: 'cat_business' }, { text: '🏥 Health/Fitness', callback_data: 'cat_health' }],
            [{ text: '📚 General/Other', callback_data: 'cat_general' }, { text: '⏭️ Skip Category', callback_data: 'cat_skip' }]
        ]
    }
});


// --- BOT COMMANDS ---
bot.onText(/\/start|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await db.findOrCreateUser(chatId);
    const stats = await db.getUserStats(chatId);
    const streak = await db.getUserStreak(chatId);
    const welcomeText = `
🎓 *Welcome to your AI Learning Companion!*

${stats.total > 0 ? `🔥 Learning streak: ${streak} days\n📚 Total learnings: ${stats.total}\n\n` : ''}*Quick Actions:*
• Use the menu buttons below for quick access
• Type /learn to log something you learned
• Use /quick for rapid learning entries

*Pro Tips:*
• Set daily goals with /goals
• Search your knowledge with /search
• Export your progress with /export

Ready to learn something new today? 🚀
    `;
    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
});

bot.onText(/\/learn(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const content = match[1];

    if (!content) {
        bot.sendMessage(chatId, "📚 *What did you learn today?*\n\nTell me something new you discovered, understood, or mastered!", { 
            parse_mode: 'Markdown',
            reply_markup: { force_reply: true, input_field_placeholder: "I learned that..." }
        });
        userStates[chatId] = { command: 'waiting_for_learning' };
        return;
    }
    await processLearningEntry(chatId, content);
});

bot.onText(/\/quick/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⚡ *Quick Learning Entry*\n\nJust type what you learned - I'll save it instantly!", {
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true, input_field_placeholder: "Quick note..." }
    });
    userStates[chatId] = { command: 'quick_learn' };
});

bot.onText(/\/search(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1];

    if (!query) {
        bot.sendMessage(chatId, "🔍 *Search Your Learnings*\n\nWhat topic would you like to search for?", {
            parse_mode: 'Markdown',
            reply_markup: { force_reply: true, input_field_placeholder: "Search for..." }
        });
        userStates[chatId] = { command: 'search' };
        return;
    }

    const results = await db.searchLearnings(chatId, query);
    if (results.length === 0) {
        bot.sendMessage(chatId, `🔍 No learnings found for "${query}"`);
        return;
    }
    const formattedResults = results.map((l, i) => `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd, yyyy')}`).join('\n\n');
    bot.sendMessage(chatId, `🔍 *Search Results for "${query}"*\n\n${formattedResults}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, async (msg) => {
    await showUserStats(msg.chat.id);
});

bot.onText(/\/goals/, async (msg) => {
    const chatId = msg.chat.id;
    const currentGoal = await db.getUserGoal(chatId);
    bot.sendMessage(chatId, `🎯 *Daily Learning Goals*\n\n${currentGoal ? `Current goal: ${currentGoal} learnings per day` : 'No goal set yet'}\n\nHow many things would you like to learn each day?`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '1️⃣ 1 per day', callback_data: 'goal_1' }, { text: '2️⃣ 2 per day', callback_data: 'goal_2' }, { text: '3️⃣ 3 per day', callback_data: 'goal_3' }],
                [{ text: '5️⃣ 5 per day', callback_data: 'goal_5' }, { text: '🔢 Custom', callback_data: 'goal_custom' }]
            ]
        }
    });
});

bot.onText(/\/view/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "👀 *View Your Learning History*\n\nWhich period would you like to see?", {
        parse_mode: 'Markdown',
        ...getViewOptionsKeyboard()
    });
});

bot.onText(/\/export/, async (msg) => {
    await handleExport(msg.chat.id);
});

bot.onText(/\/summarize/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🤖 Analyzing your learning journey... This might take a moment.");
    const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date());
    if (learnings.length === 0) {
        bot.sendMessage(chatId, "📭 No learnings from the past week. Start your learning streak today!");
        return;
    }
    const summary = await ai.generateWeeklyAnalysis(learnings, 'summary');
    bot.sendMessage(chatId, `📝 *Your Weekly Learning Summary*\n\n${summary}`, { 
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🧠 Take Quiz', callback_data: 'start_quiz' }, { text: '🔙 Main Menu', callback_data: 'main_menu' }]] }
    });
});

bot.onText(/\/quiz/, async (msg) => {
    await startQuiz(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        bot.sendMessage(chatId, "✅ *Session ended!*\n\nGreat job on your learning session. Ready for more?", {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard()
        });
    } else {
        bot.sendMessage(chatId, "ℹ️ No active session to stop.");
    }
});


// --- HELPER FUNCTIONS ---

// This function takes HTML content and returns a PDF buffer
async function generatePdf(htmlContent) {
    let browser = null;
    try {
        // Launch a headless browser. The args are important for running in containerized environments.
        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        
        // Set the HTML content of the page
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Generate the PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        
        return pdfBuffer;
    } catch (error) {
        console.error("Error generating PDF:", error);
        return null; // Return null if PDF generation fails
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Exports learning data as a PDF file
async function handleExport(chatId) {
    bot.sendMessage(chatId, "📤 Preparing your learning export as a PDF... This may take a moment.");

    const learnings = await db.getAllUserLearnings(chatId);
    if (learnings.length === 0) {
        bot.sendMessage(chatId, "📭 No learnings to export yet.");
        return;
    }

    // Generate HTML from the learning data
    const learningsHtml = learnings.map(l => {
        const date = format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm');
        const category = l.category ? `<b>[${l.category}]</b> ` : '';
        const content = l.content.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Sanitize HTML in content
        return `<p><em>${date}</em>: ${category}${content}</p>`;
    }).join('\n');

    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Learning Diary Export</title>
            <style>
                body { font-family: sans-serif; line-height: 1.6; }
                h1 { color: #2c3e50; }
                p { border-bottom: 1px solid #eee; padding-bottom: 10px; }
                b { color: #2980b9; }
                em { color: #7f8c8d; }
            </style>
        </head>
        <body>
            <h1>Your Learning Diary</h1>
            ${learningsHtml}
        </body>
        </html>
    `;

    const pdfBuffer = await generatePdf(fullHtml);

    if (pdfBuffer) {
        bot.sendDocument(chatId, pdfBuffer, {
            caption: `📚 Here is your complete learning diary.\n📊 Total entries: ${learnings.length}`
        }, {
            filename: `learning-diary-${format(new Date(), 'yyyy-MM-dd')}.pdf`,
            contentType: 'application/pdf',
        });
    } else {
        bot.sendMessage(chatId, "❌ Sorry, there was an error creating your PDF file.");
    }
}

async function processLearningEntry(chatId, content, category = null, generateFollowUp = true) {
    await db.addLearning(chatId, content, category);
    
    const todayCount = await db.getTodayLearningsCount(chatId);
    const userGoal = await db.getUserGoal(chatId);
    const streak = await db.getUserStreak(chatId);
    
    let progressText = `✅ *Learning saved!* (${todayCount} today)`;
    if (userGoal) {
        const progress = Math.min(100, Math.round((todayCount / userGoal) * 100));
        progressText += `\n🎯 Daily goal progress: ${progress}%`;
        
        if (todayCount >= userGoal) {
            progressText += `\n🎉 Daily goal achieved! Streak: ${streak} days`;
        }
    }
    
    bot.sendMessage(chatId, progressText, { parse_mode: 'Markdown' });
    
    if (generateFollowUp) {
        bot.sendMessage(chatId, "🤔 Let me think of a good question...");
        const followUp = await ai.generateFollowUpQuestion(content);
        
        userStates[chatId] = { command: 'ai_convo', originalContent: content };
        bot.sendMessage(chatId, `💭 ${followUp}\n\n*Reply to continue our discussion or use /stop to end*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✋ Stop Discussion', callback_data: 'stop_convo' },
                    { text: '📚 Log Another', callback_data: 'quick_learn' }
                ]]
            }
        });
    }
}

async function showUserStats(chatId) {
    const stats = await db.getUserStats(chatId);
    const streak = await db.getUserStreak(chatId);
    const todayCount = await db.getTodayLearningsCount(chatId);
    const goal = await db.getUserGoal(chatId);
    const topCategories = await db.getTopCategories(chatId);
    
    let statsText = `📊 *Your Learning Statistics*\n\n`;
    statsText += `🔥 Current streak: ${streak} days\n`;
    statsText += `📚 Total learnings: ${stats.total}\n`;
    statsText += `📅 Today: ${todayCount} learnings\n`;
    statsText += `📈 Weekly average: ${Math.round(stats.weeklyAverage * 10) / 10}\n\n`;
    
    if (goal) {
        statsText += `🎯 Daily goal: ${todayCount}/${goal} (${Math.min(100, Math.round((todayCount / goal) * 100))}%)\n\n`;
    }
    
    if (topCategories.length > 0) {
        statsText += `🏆 *Top Categories:*\n`;
        topCategories.forEach((cat, i) => {
            statsText += `${i + 1}. ${cat.name}: ${cat.count} learnings\n`;
        });
    }
    
    bot.sendMessage(chatId, statsText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '🎯 Set Goal', callback_data: 'manage_goals' }, { text: '📤 Export Data', callback_data: 'export_data' }]]
        }
    });
}

// Generates a quiz as a PDF file
async function startQuiz(chatId) {
    bot.sendMessage(chatId, "🧠 Preparing your personalized quiz as a PDF...");

    const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date());
    if (learnings.length < 3) {
        bot.sendMessage(chatId, "📚 You need at least 3 learnings from the past week to generate a quiz.");
        return;
    }

    // Get quiz content (assuming it's Markdown from the AI)
    const quizMarkdown = await ai.generateWeeklyAnalysis(learnings, 'quiz');
    
    // Convert Markdown to HTML
    const quizHtmlContent = marked.parse(quizMarkdown);

    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Your Personalized Quiz</title>
            <style>
                body { font-family: sans-serif; line-height: 1.6; }
                h1, h2, h3 { color: #2c3e50; }
                code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
                blockquote { border-left: 3px solid #ccc; padding-left: 15px; color: #555; font-style: italic; }
            </style>
        </head>
        <body>
            <h1>🧠 Your Personalized Quiz</h1>
            <p>Based on your learnings from the last 7 days.</p>
            <hr>
            ${quizHtmlContent}
        </body>
        </html>
    `;

    const pdfBuffer = await generatePdf(fullHtml);
    
    if (pdfBuffer) {
        bot.sendDocument(chatId, pdfBuffer, {
            caption: "Here is your personalized quiz. Good luck! 🍀"
        }, {
            filename: 'personalized-quiz.pdf',
            contentType: 'application/pdf'
        });
    } else {
        bot.sendMessage(chatId, "❌ Sorry, there was an error creating your quiz PDF.");
    }
}


// --- CALLBACK & MESSAGE HANDLERS ---

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const action = callbackQuery.data;
    const now = new Date();

    try {
        if (action.startsWith('view_')) {
            let learnings, title;
            switch (action) {
                case 'view_today':
                    learnings = await db.getLearningsForDateRange(chatId, startOfDay(now), endOfDay(now));
                    title = "📅 Today's Learnings";
                    break;
                case 'view_yesterday':
                    const yesterday = subDays(now, 1);
                    learnings = await db.getLearningsForDateRange(chatId, startOfDay(yesterday), endOfDay(yesterday));
                    title = "📅 Yesterday's Learnings";
                    break;
                case 'view_week':
                    learnings = await db.getLearningsForDateRange(chatId, subDays(now, 7), now);
                    title = "📅 Past 7 Days";
                    break;
                case 'view_month':
                    learnings = await db.getLearningsForDateRange(chatId, subDays(now, 30), now);
                    title = "📅 Past 30 Days";
                    break;
            }
            if (learnings) {
                bot.editMessageText(`*${title}*\n\n${formatLearnings(learnings)}`, {
                    chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 View Options', callback_data: 'back_to_view' }, { text: '🏠 Main Menu', callback_data: 'main_menu' }]] }
                });
            }
        }
        else if (action.startsWith('cat_')) {
            const categories = { 'cat_tech': 'Tech/Programming', 'cat_science': 'Science', 'cat_creative': 'Creative/Art', 'cat_language': 'Language', 'cat_business': 'Business', 'cat_health': 'Health/Fitness', 'cat_general': 'General', 'cat_skip': null };
            const category = categories[action];
            if (userStates[chatId] && userStates[chatId].pendingContent) {
                // The '/learn' flow finishes here
                await processLearningEntry(chatId, userStates[chatId].pendingContent, category);
                delete userStates[chatId];
            }
        }
        else if (action.startsWith('goal_')) {
            const goalValue = action === 'goal_custom' ? null : parseInt(action.split('_')[1]);
            if (goalValue) {
                await db.setUserGoal(chatId, goalValue);
                bot.editMessageText(`🎯 *Goal Set!*\n\nYour daily learning goal: ${goalValue} per day.`, {
                    chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown', ...getMainMenuKeyboard()
                });
            } else {
                bot.editMessageText("🔢 Enter your custom daily goal (number of learnings per day):", {
                    chat_id: chatId, message_id: callbackQuery.message.message_id,
                    reply_markup: { force_reply: true }
                });
                userStates[chatId] = { command: 'custom_goal' };
            }
        }
        else if (action === 'export_data') {
            await handleExport(chatId);
        }
        else if (action === 'quick_learn') {
            bot.sendMessage(chatId, "⚡ *Quick Learning Entry*\n\nWhat did you learn?", {
                parse_mode: 'Markdown', reply_markup: { force_reply: true }
            });
            userStates[chatId] = { command: 'quick_learn' };
        }
        else if (action === 'show_stats') { await showUserStats(chatId); }
        else if (action === 'start_quiz') { await startQuiz(chatId); }
        else if (action === 'main_menu') {
            bot.editMessageText("🏠 *Main Menu*\n\nWhat would you like to do?", {
                chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown', ...getMainMenuKeyboard()
            });
        }
        else if (action === 'back_to_view') {
            bot.editMessageText("👀 *View Your Learning History*\n\nWhich period would you like to see?", {
                chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown', ...getViewOptionsKeyboard()
            });
        }
        else if (action === 'stop_convo') {
            delete userStates[chatId];
            bot.editMessageText("Ok, discussion ended. What's next?", {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                ...getMainMenuKeyboard()
            });
        }

        bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Callback query error:', error);
        bot.answerCallbackQuery(callbackQuery.id, { text: "Something went wrong. Please try again." });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return;
    const state = userStates[chatId];
    if (!state) return;
    
    try {
        switch (state.command) {
            case 'waiting_for_learning':
                userStates[chatId].pendingContent = msg.text;
                bot.sendMessage(chatId, "🏷️ *Choose a category* (optional):", { parse_mode: 'Markdown', ...getLearningCategories() });
                break;
            case 'quick_learn':
                await processLearningEntry(chatId, msg.text, null, false);
                delete userStates[chatId];
                break;
            case 'search':
                const results = await db.searchLearnings(chatId, msg.text);
                if (results.length === 0) {
                    bot.sendMessage(chatId, `🔍 No results found for "${msg.text}"`);
                } else {
                    const formattedResults = results.slice(0, 10).map((l, i) => `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd')}`).join('\n\n');
                    bot.sendMessage(chatId, `🔍 *Found ${results.length} result(s) for "${msg.text}"*\n\n${formattedResults}${results.length > 10 ? '\n\n...and more' : ''}`, { parse_mode: 'Markdown' });
                }
                delete userStates[chatId];
                break;
            case 'custom_goal':
                const goalNum = parseInt(msg.text);
                if (goalNum && goalNum > 0 && goalNum <= 50) {
                    await db.setUserGoal(chatId, goalNum);
                    bot.sendMessage(chatId, `🎯 Perfect! Your daily goal is set to ${goalNum} learnings per day.`, { ...getMainMenuKeyboard() });
                } else {
                    bot.sendMessage(chatId, "❌ Please enter a valid number between 1 and 50.");
                    return;
                }
                delete userStates[chatId];
                break;
            case 'ai_convo':
                const userReply = msg.text;
                await db.addLearning(chatId, `💭 Follow-up thought: ${userReply}`);
                const followUp = await ai.generateFollowUpQuestion(userReply);
                bot.sendMessage(chatId, `🤔 ${followUp}\n\n*Keep the conversation going or /stop*`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '✋ End Discussion', callback_data: 'stop_convo' }, { text: '📚 New Learning', callback_data: 'quick_learn' }]]
                    }
                });
                break;
        }
    } catch (error) {
        console.error('Message handling error:', error);
        bot.sendMessage(chatId, "❌ Something went wrong. Please try again or use /start for help.");
        delete userStates[chatId];
    }
});


// --- CRON JOB & ERROR HANDLING ---

cron.schedule('0 20 * * 0', async () => {
    const users = await db.getAllUsers();
    for (const user of users) {
        const weekLearnings = await db.getLearningsForDateRange(user.chatId, subDays(new Date(), 7), new Date());
        if (weekLearnings.length > 0) {
            const summary = await ai.generateWeeklyAnalysis(weekLearnings, 'summary');
            bot.sendMessage(user.chatId, `🎓 *Weekly Learning Wrap-up*\n\n${summary}\n\n🚀 Ready for another week of learning?`, { 
                parse_mode: 'Markdown', ...getMainMenuKeyboard()
            });
        }
    }
});

bot.on('polling_error', (error) => {
    console.error(`[Polling Error] ${error.code}: ${error.message}`);
});

console.log("🚀 Enhanced AI Learning Diary Bot is running with PDF support...");