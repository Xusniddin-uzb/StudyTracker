const mongoose = require('mongoose');

// --- Connect to MongoDB ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("MongoDB connection SUCCESS");
    } catch (error) {
        console.error("MongoDB connection FAIL:", error);
        process.exit(1);
    }
};
connectDB();

// --- Enhanced Schemas ---
const UserSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true, index: true },
    quizDay: { type: Number, default: 0 },
    quizTime: { type: Number, default: 20 },
    dailyGoal: { type: Number, default: null }, // Daily learning goal
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
    settings: {
        notifications: { type: Boolean, default: true },
        language: { type: String, default: 'en' },
        timezone: { type: String, default: 'UTC' }
    }
});

const LearningSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, index: true },
    content: { type: String, required: true },
    category: { type: String, default: null }, // Learning category
    difficulty: { type: Number, min: 1, max: 5, default: null }, // User-rated difficulty
    tags: [{ type: String }], // Auto-generated or user tags
    isAIGenerated: { type: Boolean, default: false }, // Track if content is AI follow-up
    confidence: { type: Number, min: 1, max: 5, default: null }, // User confidence level
    source: { type: String, default: null } // Where they learned it (book, course, etc.)
}, { timestamps: true });

// Add text index for search functionality
LearningSchema.index({ content: 'text', tags: 'text' });

// --- Create Models ---
const User = mongoose.model('User', UserSchema);
const Learning = mongoose.model('Learning', LearningSchema);

// --- Enhanced Database Functions ---

const findOrCreateUser = async (chatId) => {
    const user = await User.findOneAndUpdate(
        { chatId }, 
        { 
            lastActiveAt: new Date(),
            $setOnInsert: { joinedAt: new Date() }
        }, 
        { upsert: true, new: true }
    );
    return user;
};

const setQuizTime = async (chatId, day, time) => {
    await User.updateOne({ chatId }, { quizDay: day, quizTime: time });
};

const setUserGoal = async (chatId, goal) => {
    await User.updateOne({ chatId }, { dailyGoal: goal });
};

const getUserGoal = async (chatId) => {
    const user = await User.findOne({ chatId });
    return user?.dailyGoal || null;
};

// Add a learning entry with enhanced features
const addLearning = async (chatId, content, category = null, options = {}) => {
    const learning = await Learning.create({
        chatId,
        content,
        category,
        difficulty: options.difficulty || null,
        tags: options.tags || [],
        isAIGenerated: options.isAIGenerated || false,
        confidence: options.confidence || null,
        source: options.source || null
    });
    
    // Update user's last active time
    await User.updateOne({ chatId }, { lastActiveAt: new Date() });
    
    return learning;
};

// Get learnings for a specific date range
const getLearningsForDateRange = async (chatId, startDate, endDate) => {
    return Learning.find({
        chatId,
        createdAt: { $gte: startDate, $lt: endDate }
    }).sort({ createdAt: 'desc' });
};

// Search learnings by text
const searchLearnings = async (chatId, query, limit = 20) => {
    return Learning.find({
        chatId,
        $text: { $search: query }
    })
    .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
    .limit(limit);
};

// Get all learnings for a user (for export)
const getAllUserLearnings = async (chatId) => {
    return Learning.find({ chatId }).sort({ createdAt: -1 });
};

// Get today's learning count
const getTodayLearningsCount = async (chatId) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    
    return Learning.countDocuments({
        chatId,
        createdAt: { $gte: startOfDay, $lt: endOfDay }
    });
};

// Get user learning statistics
const getUserStats = async (chatId) => {
    const totalCount = await Learning.countDocuments({ chatId });
    
    // Get weekly average
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekCount = await Learning.countDocuments({
        chatId,
        createdAt: { $gte: sevenDaysAgo }
    });
    
    // Get monthly count
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthCount = await Learning.countDocuments({
        chatId,
        createdAt: { $gte: thirtyDaysAgo }
    });
    
    return {
        total: totalCount,
        thisWeek: weekCount,
        thisMonth: monthCount,
        weeklyAverage: weekCount / 7,
        monthlyAverage: monthCount / 30
    };
};

// Calculate learning streak
const getUserStreak = async (chatId) => {
    const learnings = await Learning.find({ chatId })
        .sort({ createdAt: -1 })
        .select('createdAt');
    
    if (learnings.length === 0) return 0;
    
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    
    // Group learnings by date
    const learningsByDate = {};
    learnings.forEach(learning => {
        const dateKey = learning.createdAt.toISOString().split('T')[0];
        learningsByDate[dateKey] = true;
    });
    
    // Check streak starting from today
    while (true) {
        const dateKey = currentDate.toISOString().split('T')[0];
        
        if (learningsByDate[dateKey]) {
            streak++;
            currentDate.setDate(currentDate.getDate() - 1);
        } else if (streak === 0 && dateKey === new Date().toISOString().split('T')[0]) {
            // Today hasn't been logged yet, check yesterday
            currentDate.setDate(currentDate.getDate() - 1);
        } else {
            break;
        }
    }
    
    return streak;
};

// Get top learning categories for a user
const getTopCategories = async (chatId, limit = 5) => {
    const categories = await Learning.aggregate([
        { $match: { chatId, category: { $ne: null } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
        { $project: { name: '$_id', count: 1, _id: 0 } }
    ]);
    
    return categories;
};

// Get learning analytics by category
const getCategoryAnalytics = async (chatId) => {
    return Learning.aggregate([
        { $match: { chatId } },
        { 
            $group: {
                _id: { 
                    category: '$category',
                    month: { $month: '$createdAt' },
                    year: { $year: '$createdAt' }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.year': -1, '_id.month': -1, count: -1 } }
    ]);
};

// Get recent learning trends
const getLearningTrends = async (chatId, days = 30) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return Learning.aggregate([
        { 
            $match: { 
                chatId, 
                createdAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);
};

// Get all users (for scheduled tasks)
const getAllUsers = async () => {
    return User.find({});
};

// Get users who haven't learned today (for reminders)
const getInactiveUsers = async () => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const activeUserIds = await Learning.distinct('chatId', {
        createdAt: { $gte: startOfDay }
    });
    
    return User.find({
        chatId: { $nin: activeUserIds },
        'settings.notifications': true
    });
};

// Update user settings
const updateUserSettings = async (chatId, settings) => {
    return User.updateOne(
        { chatId },
        { $set: { settings: { ...settings } } }
    );
};

// Get learning statistics for admin/analytics
const getGlobalStats = async () => {
    const totalUsers = await User.countDocuments();
    const totalLearnings = await Learning.countDocuments();
    const activeUsers = await User.countDocuments({
        lastActiveAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    return {
        totalUsers,
        totalLearnings,
        activeUsers,
        averageLearningsPerUser: Math.round(totalLearnings / totalUsers * 10) / 10
    };
};

// Clean up old data (optional maintenance function)
const cleanupOldData = async (daysToKeep = 365) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const result = await Learning.deleteMany({
        createdAt: { $lt: cutoffDate }
    });
    
    console.log(`Cleaned up ${result.deletedCount} old learning entries`);
    return result.deletedCount;
};

module.exports = {
    // Basic functions
    findOrCreateUser,
    setQuizTime,
    addLearning,
    getLearningsForDateRange,
    getAllUsers,
    
    // Enhanced functions
    setUserGoal,
    getUserGoal,
    searchLearnings,
    getAllUserLearnings,
    getTodayLearningsCount,
    getUserStats,
    getUserStreak,
    getTopCategories,
    getCategoryAnalytics,
    getLearningTrends,
    getInactiveUsers,
    updateUserSettings,
    getGlobalStats,
    cleanupOldData
};