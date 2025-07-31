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

// --- Define Schemas ---
const UserSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true, index: true },
    quizDay: { type: Number, default: 0 }, // 0=Sunday, 1=Monday, ...
    quizTime: { type: Number, default: 20 }  // Hour of the day (0-23)
});

const LogSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, index: true },
    work: String,
    learn: String,
    blockers: String
}, { timestamps: true }); // `timestamps: true` adds `createdAt` and `updatedAt`

// --- Create Models ---
const User = mongoose.model('User', UserSchema);
const Log = mongoose.model('Log', LogSchema);


// --- Database Functions ---

const findOrCreateUser = async (chatId) => {
    // `upsert: true` creates the document if it doesn't exist.
    await User.findOneAndUpdate({ chatId }, {}, { upsert: true, new: true });
};

const setQuizTime = async (chatId, day, time) => {
    await User.updateOne({ chatId }, { quizDay: day, quizTime: time });
};

const addLog = async (chatId, { work, learn, blockers }) => {
    await Log.create({ chatId, work, learn, blockers });
};

const getWeeklyLogs = async (chatId) => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const logs = await Log.find({
        chatId,
        createdAt: { $gte: sevenDaysAgo }
    }).sort({ createdAt: 'asc' });
    
    // Format logs to match what the AI function expects
    return logs.map(log => ({
        date: log.createdAt.toISOString().split('T')[0],
        work: log.work,
        learn: log.learn,
        blockers: log.blockers,
    }));
};

const getAllUsers = async () => {
    return User.find({});
};

module.exports = { findOrCreateUser, setQuizTime, addLog, getWeeklyLogs, getAllUsers };