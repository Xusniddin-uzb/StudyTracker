require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');
const ai = require('./ai');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

const token = process.env.TELEGRAM_API_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_API_TOKEN is not defined.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Set persistent menu commands
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

// Enhanced user states management
const userStates = {};
const userSettings = {}; // Store user preferences

// --- Enhanced Helper Functions ---
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
            [
                { text: '📚 Quick Learn', callback_data: 'quick_learn' },
                { text: '👀 View Today', callback_data: 'view_today' }
            ],
            [
                { text: '📊 My Stats', callback_data: 'show_stats' },
                { text: '🎯 Goals', callback_data: 'manage_goals' }
            ],
            [
                { text: '🧠 Take Quiz', callback_data: 'start_quiz' },
                { text: '🔍 Search', callback_data: 'start_search' }
            ]
        ]
    }
});

const getViewOptionsKeyboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: '📅 Today', callback_data: 'view_today' },
                { text: '📅 Yesterday', callback_data: 'view_yesterday' }
            ],
            [
                { text: '📅 This Week', callback_data: 'view_week' },
                { text: '📅 This Month', callback_data: 'view_month' }
            ],
            [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
        ]
    }
});

const getLearningCategories = () => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: '💻 Tech/Programming', callback_data: 'cat_tech' },
                { text: '🔬 Science', callback_data: 'cat_science' }
            ],
            [
                { text: '🎨 Creative/Art', callback_data: 'cat_creative' },
                { text: '📖 Language', callback_data: 'cat_language' }
            ],
            [
                { text: '💼 Business', callback_data: 'cat_business' },
                { text: '🏥 Health/Fitness', callback_data: 'cat_health' }
            ],
            [
                { text: '📚 General/Other', callback_data: 'cat_general' },
                { text: '⏭️ Skip Category', callback_data: 'cat_skip' }
            ]
        ]
    }
});

// --- Enhanced Bot Commands ---
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
    
    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard()
    });
});

bot.onText(/\/learn(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const content = match[1];

    if (!content) {
        bot.sendMessage(chatId, 
            "📚 *What did you learn today?*\n\nTell me something new you discovered, understood, or mastered!\n\n💡 *Examples:*\n• Learned how to use async/await in JavaScript\n• Discovered that octopuses have three hearts\n• Understood the concept of compound interest", 
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    force_reply: true,
                    input_field_placeholder: "I learned that..."
                }
            }
        );
        userStates[chatId] = { command: 'waiting_for_learning' };
        return;
    }

    await processLearningEntry(chatId, content);
});

bot.onText(/\/quick/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        "⚡ *Quick Learning Entry*\n\nJust type what you learned - I'll save it instantly!", 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                force_reply: true,
                input_field_placeholder: "Quick note..."
            }
        }
    );
    userStates[chatId] = { command: 'quick_learn' };
});

bot.onText(/\/search(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1];

    if (!query) {
        bot.sendMessage(chatId, 
            "🔍 *Search Your Learnings*\n\nWhat topic would you like to search for?", 
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    force_reply: true,
                    input_field_placeholder: "Search for..."
                }
            }
        );
        userStates[chatId] = { command: 'search' };
        return;
    }

    const results = await db.searchLearnings(chatId, query);
    if (results.length === 0) {
        bot.sendMessage(chatId, `🔍 No learnings found for "${query}"\n\nTry different keywords or browse your history with /view`);
        return;
    }

    const formattedResults = results.map((l, i) => 
        `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd, yyyy')}`
    ).join('\n\n');

    bot.sendMessage(chatId, 
        `🔍 *Search Results for "${query}"*\n\n${formattedResults}`, 
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    await showUserStats(chatId);
});

bot.onText(/\/goals/, async (msg) => {
    const chatId = msg.chat.id;
    const currentGoal = await db.getUserGoal(chatId);
    
    bot.sendMessage(chatId, 
        `🎯 *Daily Learning Goals*\n\n${currentGoal ? `Current goal: ${currentGoal} learnings per day` : 'No goal set yet'}\n\nHow many things would you like to learn each day?`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '1️⃣ 1 per day', callback_data: 'goal_1' },
                        { text: '2️⃣ 2 per day', callback_data: 'goal_2' },
                        { text: '3️⃣ 3 per day', callback_data: 'goal_3' }
                    ],
                    [
                        { text: '5️⃣ 5 per day', callback_data: 'goal_5' },
                        { text: '🔢 Custom', callback_data: 'goal_custom' }
                    ]
                ]
            }
        }
    );
});

bot.onText(/\/view/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        "👀 *View Your Learning History*\n\nWhich period would you like to see?", 
        {
            parse_mode: 'Markdown',
            ...getViewOptionsKeyboard()
        }
    );
});

bot.onText(/\/export/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "📤 Preparing your learning export... This may take a moment.");
    
    const learnings = await db.getAllUserLearnings(chatId);
    if (learnings.length === 0) {
        bot.sendMessage(chatId, "📭 No learnings to export yet. Start logging your learning journey!");
        return;
    }

    const exportText = learnings.map(l => {
        const date = format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm');
        return `[${date}] ${l.content}`;
    }).join('\n');

    // Send as file
    bot.sendDocument(chatId, Buffer.from(exportText), {
        filename: `learning-diary-${format(new Date(), 'yyyy-MM-dd')}.txt`
    }, {
        caption: `📚 Your complete learning diary\n📊 Total entries: ${learnings.length}`
    });
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
        reply_markup: {
            inline_keyboard: [[
                { text: '🧠 Take Quiz', callback_data: 'start_quiz' },
                { text: '🔙 Main Menu', callback_data: 'main_menu' }
            ]]
        }
    });
});

bot.onText(/\/quiz/, async (msg) => {
    const chatId = msg.chat.id;
    await startQuiz(chatId);
});

bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        bot.sendMessage(chatId, 
            "✅ *Session ended!*\n\nGreat job on your learning session. Ready for more?", 
            {
                parse_mode: 'Markdown',
                ...getMainMenuKeyboard()
            }
        );
    } else {
        bot.sendMessage(chatId, "ℹ️ No active session to stop.");
    }
});

// --- Enhanced Helper Functions ---
async function processLearningEntry(chatId, content, category = null) {
    await db.addLearning(chatId, content, category);
    
    // Check daily goal progress
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
    
    // Generate AI follow-up question
    bot.sendMessage(chatId, "🤔 Let me think of a good question...");
    const followUp = await ai.generateFollowUpQuestion(content);
    
    userStates[chatId] = { command: 'ai_convo', originalContent: content };
    bot.sendMessage(chatId, 
        `💭 ${followUp}\n\n*Reply to continue our discussion or use /stop to end*`, 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✋ Stop Discussion', callback_data: 'stop_convo' },
                    { text: '📚 Log Another', callback_data: 'quick_learn' }
                ]]
            }
        }
    );
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
        const progress = Math.min(100, Math.round((todayCount / goal) * 100));
        statsText += `🎯 Daily goal: ${todayCount}/${goal} (${progress}%)\n\n`;
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
            inline_keyboard: [[
                { text: '🎯 Set Goal', callback_data: 'manage_goals' },
                { text: '📤 Export Data', callback_data: 'export_data' }
            ]]
        }
    });
}

async function startQuiz(chatId) {
    bot.sendMessage(chatId, "🧠 Preparing your personalized quiz...");
    
    const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date());
    if (learnings.length < 3) {
        bot.sendMessage(chatId, 
            "📚 You need at least 3 learnings from the past week to generate a quiz.\n\nKeep learning and come back later!", 
            { ...getMainMenuKeyboard() }
        );
        return;
    }
    
    const quiz = await ai.generateWeeklyAnalysis(learnings, 'quiz');
    bot.sendMessage(chatId, `🧠 *Your Personalized Quiz*\n\n${quiz}`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '📝 Get Summary', callback_data: 'get_summary' },
                { text: '🔙 Main Menu', callback_data: 'main_menu' }
            ]]
        }
    });
}

// --- Enhanced Callback Handlers ---
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const action = callbackQuery.data;
    const now = new Date();

    try {
        // View actions
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
                bot.editMessageText(
                    `*${title}*\n\n${formatLearnings(learnings)}`, 
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔙 View Options', callback_data: 'back_to_view' },
                                { text: '🏠 Main Menu', callback_data: 'main_menu' }
                            ]]
                        }
                    }
                );
            }
        }
        
        // Category selection
        else if (action.startsWith('cat_')) {
            const categories = {
                'cat_tech': 'Tech/Programming',
                'cat_science': 'Science',
                'cat_creative': 'Creative/Art',
                'cat_language': 'Language',
                'cat_business': 'Business',
                'cat_health': 'Health/Fitness',
                'cat_general': 'General',
                'cat_skip': null
            };
            
            const category = categories[action];
            if (userStates[chatId] && userStates[chatId].pendingContent) {
                await processLearningEntry(chatId, userStates[chatId].pendingContent, category);
                delete userStates[chatId].pendingContent;
            }
        }
        
        // Goal setting
        else if (action.startsWith('goal_')) {
            const goalValue = action === 'goal_custom' ? null : parseInt(action.split('_')[1]);
            
            if (goalValue) {
                await db.setUserGoal(chatId, goalValue);
                bot.editMessageText(
                    `🎯 *Goal Set!*\n\nYour daily learning goal: ${goalValue} per day\n\nI'll track your progress and celebrate when you hit your target!`,
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenuKeyboard()
                    }
                );
            } else {
                bot.editMessageText(
                    "🔢 Enter your custom daily goal (number of learnings per day):",
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        reply_markup: { force_reply: true }
                    }
                );
                userStates[chatId] = { command: 'custom_goal' };
            }
        }
        
        // Quick actions
        else if (action === 'quick_learn') {
            bot.sendMessage(chatId, 
                "⚡ *Quick Learning Entry*\n\nWhat did you learn?", 
                {
                    parse_mode: 'Markdown',
                    reply_markup: { force_reply: true }
                }
            );
            userStates[chatId] = { command: 'quick_learn' };
        }
        
        else if (action === 'show_stats') {
            await showUserStats(chatId);
        }
        
        else if (action === 'start_quiz') {
            await startQuiz(chatId);
        }
        
        else if (action === 'main_menu') {
            bot.editMessageText(
                "🏠 *Main Menu*\n\nWhat would you like to do?",
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown',
                    ...getMainMenuKeyboard()
                }
            );
        }
        
        else if (action === 'back_to_view') {
            bot.editMessageText(
                "👀 *View Your Learning History*\n\nWhich period would you like to see?",
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'Markdown',
                    ...getViewOptionsKeyboard()
                }
            );
        }

        bot.answerCallbackQuery(callbackQuery.id);
        
    } catch (error) {
        console.error('Callback query error:', error);
        bot.answerCallbackQuery(callbackQuery.id, { text: "Something went wrong. Please try again." });
    }
});

// --- Enhanced Message Handler ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Skip if it's a command
    if (msg.text && msg.text.startsWith('/')) return;
    
    const state = userStates[chatId];
    if (!state) return;
    
    try {
        switch (state.command) {
            case 'waiting_for_learning':
                userStates[chatId].pendingContent = msg.text;
                bot.sendMessage(chatId, 
                    "🏷️ *Choose a category* (optional):", 
                    {
                        parse_mode: 'Markdown',
                        ...getLearningCategories()
                    }
                );
                break;
                
            case 'quick_learn':
                await processLearningEntry(chatId, msg.text);
                delete userStates[chatId];
                break;
                
            case 'search':
                const results = await db.searchLearnings(chatId, msg.text);
                if (results.length === 0) {
                    bot.sendMessage(chatId, `🔍 No results found for "${msg.text}"\n\nTry different keywords!`);
                } else {
                    const formattedResults = results.slice(0, 10).map((l, i) => 
                        `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd')}`
                    ).join('\n\n');
                    
                    bot.sendMessage(chatId, 
                        `🔍 *Found ${results.length} result(s) for "${msg.text}"*\n\n${formattedResults}${results.length > 10 ? '\n\n...and more' : ''}`, 
                        { parse_mode: 'Markdown' }
                    );
                }
                delete userStates[chatId];
                break;
                
            case 'custom_goal':
                const goalNum = parseInt(msg.text);
                if (goalNum && goalNum > 0 && goalNum <= 50) {
                    await db.setUserGoal(chatId, goalNum);
                    bot.sendMessage(chatId, 
                        `🎯 Perfect! Your daily goal is set to ${goalNum} learnings per day.`, 
                        { ...getMainMenuKeyboard() }
                    );
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
                bot.sendMessage(chatId, 
                    `🤔 ${followUp}\n\n*Keep the conversation going or /stop*`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✋ End Discussion', callback_data: 'stop_convo' },
                                { text: '📚 New Learning', callback_data: 'quick_learn' }
                            ]]
                        }
                    }
                );
                break;
        }
    } catch (error) {
        console.error('Message handling error:', error);
        bot.sendMessage(chatId, "❌ Something went wrong. Please try again or use /start for help.");
        delete userStates[chatId];
    }
});

// --- Daily Motivation (Sunday evening) ---
cron.schedule('0 20 * * 0', async () => {
    const users = await db.getAllUsers();
    for (const user of users) {
        const weekLearnings = await db.getLearningsForDateRange(
            user.chatId, 
            subDays(new Date(), 7), 
            new Date()
        );
        
        if (weekLearnings.length > 0) {
            const summary = await ai.generateWeeklyAnalysis(weekLearnings, 'summary');
            bot.sendMessage(user.chatId, 
                `🎓 *Weekly Learning Wrap-up*\n\n${summary}\n\n🚀 Ready for another week of learning?`,
                { 
                    parse_mode: 'Markdown',
                    ...getMainMenuKeyboard()
                }
            );
        }
    }
});

// --- Error Handling ---
bot.on('polling_error', (error) => {
    console.error(`[Polling Error] ${error.code}: ${error.message}`);
});

console.log("🚀 Enhanced AI Learning Diary Bot is running with full menu system...");