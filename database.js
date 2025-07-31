const { Pool } = require('pg');

// The pg library will automatically use the DATABASE_URL environment variable
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // This SSL configuration is required for services like Render or Heroku
    ssl: {
        rejectUnauthorized: false
    }
});

// Function to initialize the database schema
const initializeSchema = async () => {
    const userTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        chat_id BIGINT PRIMARY KEY,
        quiz_day INT DEFAULT 0,
        quiz_time INT DEFAULT 20
    );`;

    const logsTableQuery = `
    CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT,
        work TEXT,
        learn TEXT,
        blockers TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`;

    try {
        await pool.query(userTableQuery);
        await pool.query(logsTableQuery);
        console.log("Database schema is ready.");
    } catch (err) {
        console.error("Error initializing schema:", err);
    }
};

// Immediately initialize the schema when the app starts
initializeSchema();


const findOrCreateUser = async (chatId) => {
    const query = `
        INSERT INTO users (chat_id) VALUES ($1)
        ON CONFLICT (chat_id) DO NOTHING;
    `;
    await pool.query(query, [chatId]);
};

const setQuizTime = async (chatId, day, time) => {
    const query = 'UPDATE users SET quiz_day = $1, quiz_time = $2 WHERE chat_id = $3';
    await pool.query(query, [day, time, chatId]);
};

const addLog = async (chatId, { work, learn, blockers }) => {
    const query = 'INSERT INTO logs (chat_id, work, learn, blockers) VALUES ($1, $2, $3, $4)';
    await pool.query(query, [chatId, work, learn, blockers]);
};

const getWeeklyLogs = async (chatId) => {
    const query = `
        SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, work, learn, blockers
        FROM logs
        WHERE chat_id = $1 AND created_at >= NOW() - interval '7 days'
        ORDER BY created_at ASC;
    `;
    const res = await pool.query(query, [chatId]);
    return res.rows;
};

const getAllUsers = async () => {
    const res = await pool.query('SELECT * FROM users');
    return res.rows;
};

module.exports = { findOrCreateUser, setQuizTime, addLog, getWeeklyLogs, getAllUsers };