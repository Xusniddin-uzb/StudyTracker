// A reusable helper function to call the OpenRouter API
async function callOpenRouter(model, prompt, apiKey) {
    if (!apiKey) {
        console.error(`API key is missing for model ${model}`);
        return "Sorry, the bot is not configured correctly to process this request.";
    }

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": model,
                "messages": [{ "role": "user", "content": prompt }]
            })
        });

        if (!response.ok) {
            console.error(`OpenRouter API error for model ${model}: ${response.statusText}`);
            throw new Error('API Error');
        }

        const data = await response.json();
        return data.choices[0].message.content;

    } catch (error) {
        console.error(`Error calling OpenRouter with model ${model}:`, error);
        return "Sorry, I had trouble connecting to the AI service.";
    }
}

// Uses the SLOW key for the big weekly analysis
async function generateWeeklyReview(logs) {
    if (!logs || logs.length === 0) {
        return "You didn't have any logs this week. Let's aim for a few next week! 💪";
    }

    const allLogsText = logs.map(log => `On ${log.date}:\n- Worked on: ${log.work}\n- Learned: ${log.learn}\n- Blockers: ${log.blockers}`).join('\n\n');
    const prompt = `
        Based on the following engineering diary logs, create a one-paragraph summary and 2 multiple-choice quiz questions.
        Logs:
        ${allLogsText}
    `;

    return callOpenRouter(
        "qwen/qwen3-coder:free",
        prompt,
        process.env.OPENROUTER_API_KEY_SLOW
    );
}

// Uses the FAST key for quick, interactive messages
async function generateEncouragement(userName, logContent) {
    const prompt = `A user named ${userName} just submitted this diary entry: "${logContent}". Write a very short, specific, and encouraging reply (1 sentence).`;
    
    return callOpenRouter(
        "mistralai/mistral-7b-instruct:free", // Fast model
        prompt,
        process.env.OPENROUTER_API_KEY_FAST
    );
}

module.exports = { generateWeeklyReview, generateEncouragement };