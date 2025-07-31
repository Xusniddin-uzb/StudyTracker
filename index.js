require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');
const ai = require('./ai');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');
const PDFDocument = require('pdfkit');

const token = process.env.TELEGRAM_API_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_API_TOKEN is not defined.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// --- All of your bot setup and keyboard functions ---
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
const getMainMenuKeyboard = () => ({ reply_markup: { inline_keyboard: [[{ text: '📚 Quick Learn', callback_data: 'quick_learn' }, { text: '👀 View Today', callback_data: 'view_today' }], [{ text: '📊 My Stats', callback_data: 'show_stats' }, { text: '🎯 Goals', callback_data: 'manage_goals' }], [{ text: '🧠 Take Quiz', callback_data: 'start_quiz' }, { text: '🔍 Search', callback_data: 'start_search' }]] } });
const getViewOptionsKeyboard = () => ({ reply_markup: { inline_keyboard: [[{ text: '📅 Today', callback_data: 'view_today' }, { text: '📅 Yesterday', callback_data: 'view_yesterday' }], [{ text: '📅 This Week', callback_data: 'view_week' }, { text: '📅 This Month', callback_data: 'view_month' }], [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]] } });
const getLearningCategories = () => ({ reply_markup: { inline_keyboard: [[{ text: '💻 Tech/Programming', callback_data: 'cat_tech' }, { text: '🔬 Science', callback_data: 'cat_science' }], [{ text: '🎨 Creative/Art', callback_data: 'cat_creative' }, { text: '📖 Language', callback_data: 'cat_language' }], [{ text: '💼 Business', callback_data: 'cat_business' }, { text: '🏥 Health/Fitness', callback_data: 'cat_health' }], [{ text: '📚 General/Other', callback_data: 'cat_general' }, { text: '⏭️ Skip Category', callback_data: 'cat_skip' }]] } });
const formatLearnings = (learnings) => { if (!learnings.length) return "📭 No entries found for this period."; return learnings.map((l, index) => { const date = format(new Date(l.createdAt), 'MMM dd, HH:mm'); const category = l.category ? `[${l.category}] ` : ''; return `${index + 1}. ${category}${l.content}\n   ⏰ ${date}`; }).join('\n\n'); };

// NEW: Keyboard to ask the user for the quiz format
const getQuizFormatKeyboard = () => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: '📄 PDF Quiz', callback_data: 'quiz_pdf' },
                { text: '💬 Inline Quiz', callback_data: 'quiz_inline' }
            ]
        ]
    }
});
// --- End of setup section ---

// --- HELPER FUNCTION TO GENERATE PDF BUFFER ---
function generatePdfBuffer(buildPdfCallback) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);
            buildPdfCallback(doc);
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// --- CORE FUNCTIONS ---

// MODIFIED: This function now just asks for the format
async function startQuiz(chatId) {
    bot.sendMessage(chatId, "🧠 How would you like to take your quiz?", getQuizFormatKeyboard());
}

// NEW: This function contains the logic for the PDF quiz
async function generatePdfQuiz(chatId) {
    bot.sendMessage(chatId, "🧠 Preparing your personalized quiz as a PDF...");

    const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date());
    if (learnings.length < 3) {
        bot.sendMessage(chatId, "📚 You need at least 3 learnings from the past week to generate a quiz.");
        return;
    }

    // This uses the old 'weekly analysis' AI function to get the full quiz text at once
    const quizText = await ai.generateWeeklyAnalysis(learnings, 'quiz');
    
    try {
        const pdfBuffer = await generatePdfBuffer((doc) => {
            doc.fontSize(20).font('Helvetica-Bold').text('Your Personalized Quiz', { align: 'center' });
            doc.fontSize(12).font('Helvetica-Oblique').text('Based on your learnings from the past 7 days.', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(12).font('Helvetica').text(quizText);
        });

        await bot.sendDocument(chatId, pdfBuffer, { caption: "Here is your personalized quiz. Good luck! 🍀" }, { filename: 'personalized-quiz.pdf', contentType: 'application/pdf' });
    } catch (error) {
        console.error("Failed to generate or send quiz PDF:", error.message);
        bot.sendMessage(chatId, "❌ Sorry, there was an error creating or sending your quiz PDF.");
    }
}

// NEW: This function starts the interactive inline quiz
async function startInlineQuiz(chatId) {
    bot.sendMessage(chatId, "💬 Let's start! I'll ask you questions one by one. Use /stop when you want to end the quiz.");
    
    const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date());
    if (learnings.length < 3) {
        bot.sendMessage(chatId, "📚 You need at least 3 learnings from the past week to start a quiz.");
        return;
    }

    // Set the user's state for the interactive session
    userStates[chatId] = { command: 'inline_quiz', learnings, history: [] };

    // NOTE: This assumes a new AI function that generates questions one by one.
    // The second argument is the conversation history (empty for the first question).
    const firstQuestion = await ai.getNextQuizQuestion(learnings, []);
    
    if (firstQuestion) {
        userStates[chatId].lastQuestion = firstQuestion;
        bot.sendMessage(chatId, firstQuestion);
    } else {
        bot.sendMessage(chatId, "I couldn't think of a question right now. Sorry!");
        delete userStates[chatId];
    }
}


// --- All other functions (handleExport, processLearningEntry, etc.) remain the same ---
async function handleExport(chatId) { bot.sendMessage(chatId, "📤 Preparing your learning export as a PDF..."); const learnings = await db.getAllUserLearnings(chatId); if (learnings.length === 0) { bot.sendMessage(chatId, "📭 No learnings to export yet."); return; } try { const pdfBuffer = await generatePdfBuffer((doc) => { doc.fontSize(20).font('Helvetica-Bold').text('Your Learning Diary', { align: 'center' }); doc.moveDown(2); learnings.forEach(learning => { const date = format(new Date(learning.createdAt), 'yyyy-MM-dd HH:mm'); doc.fontSize(10).font('Helvetica-Oblique').fillColor('grey').text(date); let content = ''; if (learning.category) { content += `[${learning.category}] `; } content += learning.content; doc.fontSize(12).font('Helvetica').fillColor('black').text(content, { paragraphGap: 15 }); }); }); await bot.sendDocument(chatId, pdfBuffer, { caption: `📚 Here is your complete learning diary.\n📊 Total entries: ${learnings.length}` }, { filename: `learning-diary-${format(new Date(), 'yyyy-MM-dd')}.pdf`, contentType: 'application/pdf', }); } catch (error) { console.error("Failed to generate or send export PDF:", error.message); bot.sendMessage(chatId, "❌ Sorry, there was an error creating or sending your PDF file."); } }
async function processLearningEntry(chatId, content, category = null, generateFollowUp = true) { await db.addLearning(chatId, content, category); const todayCount = await db.getTodayLearningsCount(chatId); const userGoal = await db.getUserGoal(chatId); const streak = await db.getUserStreak(chatId); let progressText = `✅ *Learning saved!* (${todayCount} today)`; if (userGoal) { const progress = Math.min(100, Math.round((todayCount / userGoal) * 100)); progressText += `\n🎯 Daily goal progress: ${progress}%`; if (todayCount >= userGoal) { progressText += `\n🎉 Daily goal achieved! Streak: ${streak} days`; } } bot.sendMessage(chatId, progressText, { parse_mode: 'Markdown' }); if (generateFollowUp) { bot.sendMessage(chatId, "🤔 Let me think of a good question..."); const followUp = await ai.generateFollowUpQuestion(content); userStates[chatId] = { command: 'ai_convo', originalContent: content }; bot.sendMessage(chatId, `💭 ${followUp}\n\n*Reply to continue our discussion or use /stop to end*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✋ Stop Discussion', callback_data: 'stop_convo' }, { text: '📚 Log Another', callback_data: 'quick_learn' }]] } }); } }
async function showUserStats(chatId) { const stats = await db.getUserStats(chatId); const streak = await db.getUserStreak(chatId); const todayCount = await db.getTodayLearningsCount(chatId); const goal = await db.getUserGoal(chatId); const topCategories = await db.getTopCategories(chatId); let statsText = `📊 *Your Learning Statistics*\n\n`; statsText += `🔥 Current streak: ${streak} days\n`; statsText += `📚 Total learnings: ${stats.total}\n`; statsText += `📅 Today: ${todayCount} learnings\n`; statsText += `📈 Weekly average: ${Math.round(stats.weeklyAverage * 10) / 10}\n\n`; if (goal) { statsText += `🎯 Daily goal: ${todayCount}/${goal} (${Math.min(100, Math.round((todayCount / goal) * 100))}%)\n\n`; } if (topCategories.length > 0) { statsText += `🏆 *Top Categories:*\n`; topCategories.forEach((cat, i) => { statsText += `${i + 1}. ${cat.name}: ${cat.count} learnings\n`; }); } bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎯 Set Goal', callback_data: 'manage_goals' }, { text: '📤 Export Data', callback_data: 'export_data' }]] } }); }

// --- BOT EVENT HANDLERS ---

bot.onText(/\/start|\/help/, async (msg) => { const chatId = msg.chat.id; await db.findOrCreateUser(chatId); await showUserStats(chatId); });
bot.onText(/\/quiz/, async (msg) => { await startQuiz(msg.chat.id); });
// ... other onText handlers
bot.onText(/\/learn(?: (.+))?/, async (msg, match) => { const chatId = msg.chat.id; const content = match[1]; if (!content) { bot.sendMessage(chatId, "📚 *What did you learn today?*\n\nTell me something new you discovered, understood, or mastered!", { parse_mode: 'Markdown', reply_markup: { force_reply: true, input_field_placeholder: "I learned that..." } }); userStates[chatId] = { command: 'waiting_for_learning' }; return; } await processLearningEntry(chatId, content); });
bot.onText(/\/quick/, (msg) => { const chatId = msg.chat.id; bot.sendMessage(chatId, "⚡ *Quick Learning Entry*\n\nJust type what you learned - I'll save it instantly!", { parse_mode: 'Markdown', reply_markup: { force_reply: true, input_field_placeholder: "Quick note..." } }); userStates[chatId] = { command: 'quick_learn' }; });
bot.onText(/\/search(?: (.+))?/, async (msg, match) => { const chatId = msg.chat.id; const query = match[1]; if (!query) { bot.sendMessage(chatId, "🔍 *Search Your Learnings*\n\nWhat topic would you like to search for?", { parse_mode: 'Markdown', reply_markup: { force_reply: true, input_field_placeholder: "Search for..." } }); userStates[chatId] = { command: 'search' }; return; } const results = await db.searchLearnings(chatId, query); if (results.length === 0) { bot.sendMessage(chatId, `🔍 No learnings found for "${query}"`); return; } const formattedResults = results.map((l, i) => `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd, yyyy')}`).join('\n\n'); bot.sendMessage(chatId, `🔍 *Search Results for "${query}"*\n\n${formattedResults}`, { parse_mode: 'Markdown' }); });
bot.onText(/\/stats/, async (msg) => { await showUserStats(msg.chat.id); });
bot.onText(/\/goals/, async (msg) => { const chatId = msg.chat.id; const currentGoal = await db.getUserGoal(chatId); bot.sendMessage(chatId, `🎯 *Daily Learning Goals*\n\n${currentGoal ? `Current goal: ${currentGoal} learnings per day` : 'No goal set yet'}\n\nHow many things would you like to learn each day?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '1️⃣ 1 per day', callback_data: 'goal_1' }, { text: '2️⃣ 2 per day', callback_data: 'goal_2' }, { text: '3️⃣ 3 per day', callback_data: 'goal_3' }], [{ text: '5️⃣ 5 per day', callback_data: 'goal_5' }, { text: '🔢 Custom', callback_data: 'goal_custom' }]] } }); });
bot.onText(/\/view/, (msg) => { const chatId = msg.chat.id; bot.sendMessage(chatId, "👀 *View Your Learning History*\n\nWhich period would you like to see?", { parse_mode: 'Markdown', ...getViewOptionsKeyboard() }); });
bot.onText(/\/export/, async (msg) => { await handleExport(msg.chat.id); });
bot.onText(/\/summarize/, async (msg) => { const chatId = msg.chat.id; bot.sendMessage(chatId, "🤖 Analyzing your learning journey... This might take a moment."); const learnings = await db.getLearningsForDateRange(chatId, subDays(new Date(), 7), new Date()); if (learnings.length === 0) { bot.sendMessage(chatId, "📭 No learnings from the past week. Start your learning streak today!"); return; } const summary = await ai.generateWeeklyAnalysis(learnings, 'summary'); bot.sendMessage(chatId, `📝 *Your Weekly Learning Summary*\n\n${summary}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🧠 Take Quiz', callback_data: 'start_quiz' }, { text: '🔙 Main Menu', callback_data: 'main_menu' }]] } }); });
bot.onText(/\/stop/, (msg) => { const chatId = msg.chat.id; if (userStates[chatId]) { delete userStates[chatId]; bot.sendMessage(chatId, "✅ *Quiz ended!* Great job.", { parse_mode: 'Markdown', ...getMainMenuKeyboard() }); } else { bot.sendMessage(chatId, "ℹ️ No active session to stop."); } });


// MODIFIED to handle the new quiz format choice
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const action = callbackQuery.data;
    
    // Dismiss the previous message/keyboard
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: callbackQuery.message.message_id });

    try {
        if (action === 'quiz_pdf') {
            await generatePdfQuiz(chatId);
        } else if (action === 'quiz_inline') {
            await startInlineQuiz(chatId);
        }
        // ... all your other callback handlers
        else if (action.startsWith('view_')) { /* ... view logic ... */ } 
        else if (action.startsWith('cat_')) { /* ... category logic ... */ } 
        else if (action.startsWith('goal_')) { /* ... goal logic ... */ } 
        else if (action === 'export_data') { await handleExport(chatId); } 
        else if (action === 'quick_learn') { bot.sendMessage(chatId, "⚡ *Quick Learning Entry*\n\nWhat did you learn?", { parse_mode: 'Markdown', reply_markup: { force_reply: true } }); userStates[chatId] = { command: 'quick_learn' }; } 
        else if (action === 'show_stats') { await showUserStats(chatId); } 
        else if (action === 'start_quiz') { await startQuiz(chatId); } 
        else if (action === 'main_menu') { bot.sendMessage(chatId, "🏠 *Main Menu*", { ...getMainMenuKeyboard() }); } 
        else if (action === 'back_to_view') { bot.sendMessage(chatId, "👀 *View Your Learning History*", { ...getViewOptionsKeyboard() }); } 
        else if (action === 'stop_convo') { delete userStates[chatId]; bot.sendMessage(chatId, "Ok, discussion ended. What's next?", { ...getMainMenuKeyboard() }); }

        bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Callback query error:', error);
        bot.answerCallbackQuery(callbackQuery.id, { text: "Something went wrong." });
    }
});

// MODIFIED to handle the new interactive quiz state
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return;
    const state = userStates[chatId];
    if (!state) return;
    
    try {
        switch (state.command) {
            case 'inline_quiz':
                const userAnswer = msg.text;
                const conversationHistory = state.history || [];
                conversationHistory.push({ role: 'user', content: `My answer to "${state.lastQuestion}" is: ${userAnswer}` });

                // NOTE: This assumes an AI function that takes history and returns the NEXT question.
                // The AI should ideally provide feedback on the last answer before asking the next question.
                const nextQuestion = await ai.getNextQuizQuestion(state.learnings, conversationHistory);

                if (nextQuestion) {
                    state.lastQuestion = nextQuestion;
                    state.history.push({ role: 'assistant', content: nextQuestion });
                    bot.sendMessage(chatId, nextQuestion);
                } else {
                    bot.sendMessage(chatId, "You've answered all the questions I can think of. Great job! Use /start to return to the menu.");
                    delete userStates[chatId];
                }
                break;
            
            // ... other message handlers
            case 'waiting_for_learning': userStates[chatId].pendingContent = msg.text; bot.sendMessage(chatId, "🏷️ *Choose a category* (optional):", { parse_mode: 'Markdown', ...getLearningCategories() }); break;
            case 'quick_learn': await processLearningEntry(chatId, msg.text, null, false); delete userStates[chatId]; break;
            case 'search': const results = await db.searchLearnings(chatId, msg.text); if (results.length === 0) { bot.sendMessage(chatId, `🔍 No results found for "${msg.text}"`); } else { const formattedResults = results.slice(0, 10).map((l, i) => `${i + 1}. ${l.content}\n   📅 ${format(new Date(l.createdAt), 'MMM dd')}`).join('\n\n'); bot.sendMessage(chatId, `🔍 *Found ${results.length} result(s) for "${msg.text}"*\n\n${formattedResults}${results.length > 10 ? '\n\n...and more' : ''}`, { parse_mode: 'Markdown' }); } delete userStates[chatId]; break;
            case 'custom_goal': const goalNum = parseInt(msg.text); if (goalNum && goalNum > 0 && goalNum <= 50) { await db.setUserGoal(chatId, goalNum); bot.sendMessage(chatId, `🎯 Perfect! Your daily goal is set to ${goalNum} learnings per day.`, { ...getMainMenuKeyboard() }); } else { bot.sendMessage(chatId, "❌ Please enter a valid number between 1 and 50."); return; } delete userStates[chatId]; break;
            case 'ai_convo': const userReply = msg.text; await db.addLearning(chatId, `💭 Follow-up thought: ${userReply}`); const followUp = await ai.generateFollowUpQuestion(userReply); bot.sendMessage(chatId, `🤔 ${followUp}\n\n*Keep the conversation going or /stop*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✋ End Discussion', callback_data: 'stop_convo' }, { text: '📚 New Learning', callback_data: 'quick_learn' }]] } }); break;
        }
    } catch (error) {
        console.error('Message handling error:', error);
        bot.sendMessage(chatId, "❌ Something went wrong. Please try again or use /start for help.");
        delete userStates[chatId];
    }
});


// --- CRON JOB & ERROR HANDLING ---
cron.schedule('0 20 * * 0', async () => { const users = await db.getAllUsers(); for (const user of users) { const weekLearnings = await db.getLearningsForDateRange(user.chatId, subDays(new Date(), 7), new Date()); if (weekLearnings.length > 0) { const summary = await ai.generateWeeklyAnalysis(weekLearnings, 'summary'); bot.sendMessage(user.chatId, `🎓 *Weekly Learning Wrap-up*\n\n${summary}\n\n🚀 Ready for another week of learning?`, { parse_mode: 'Markdown', ...getMainMenuKeyboard() }); } } });
bot.on('polling_error', (error) => { console.error(`[Polling Error] ${error.code}: ${error.message}`); });

console.log("🚀 Enhanced AI Learning Diary Bot is running with selectable quiz formats...");
