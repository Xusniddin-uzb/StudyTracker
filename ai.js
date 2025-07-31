// Enhanced AI module with better prompting and features

// A reusable helper function to call the OpenRouter API
async function callOpenRouter(model, prompt, apiKey, systemPrompt = "", options = {}) {
    if (!apiKey) {
        console.error(`API key is missing for model ${model}`);
        return "Sorry, the bot is not configured correctly.";
    }

    const messages = [];
    if (systemPrompt) {
        messages.push({ "role": "system", "content": systemPrompt });
    }
    messages.push({ "role": "user", "content": prompt });

    try {
        const requestBody = {
            "model": model,
            "messages": messages,
            "temperature": options.temperature || 0.7,
            "max_tokens": options.maxTokens || 300
        };

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.APP_URL || "https://github.com",
                "X-Title": "Learning Diary Bot"
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response format from API');
        }
        
        return data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error(`Error calling OpenRouter with model ${model}:`, error);
        return "Sorry, I had an issue connecting to the AI service. Please try again later.";
    }
}

// Enhanced follow-up question generation with more variety
async function generateFollowUpQuestion(learningEntry, context = {}) {
    const questionTypes = [
        "Ask about practical applications",
        "Explore deeper understanding", 
        "Connect to related concepts",
        "Challenge assumptions",
        "Ask for examples",
        "Explore implications"
    ];
    
    const randomType = questionTypes[Math.floor(Math.random() * questionTypes.length)];
    
    const systemPrompt = `You are an insightful learning coach. Your goal is to help learners think more deeply about what they've learned.

Based on the user's learning entry, ask ONE thoughtful, open-ended question that encourages deeper reflection. 

Focus on: ${randomType}

Guidelines:
- Keep questions concise (max 20 words)
- Be curious and engaging, not interrogating
- Don't just ask "what" - ask "how", "why", "what if"
- Avoid yes/no questions
- Don't repeat what they said back to them
- Be conversational and friendly

Just respond with the question - no extra text or explanations.`;

    return callOpenRouter(
        "mistralai/mistral-7b-instruct",
        learningEntry,
        process.env.OPENROUTER_API_KEY_FAST,
        systemPrompt,
        { temperature: 0.8, maxTokens: 100 }
    );
}

// Enhanced weekly analysis with better formatting and insights
async function generateWeeklyAnalysis(learnings, mode = 'summary') {
    if (!learnings || learnings.length === 0) {
        const emptyResponses = {
            'summary': "🌱 Your learning garden is ready to grow! Start planting some knowledge seeds this week.",
            'quiz': "📚 Once you have some learnings logged, I'll create personalized quizzes to test your knowledge. Keep learning!",
            'insights': "📊 Your learning insights will appear here once you start logging your daily discoveries."
        };
        return emptyResponses[mode] || emptyResponses['summary'];
    }

    // Group learnings by category if available
    const categorizedLearnings = {};
    const uncategorized = [];
    
    learnings.forEach(learning => {
        if (learning.category) {
            if (!categorizedLearnings[learning.category]) {
                categorizedLearnings[learning.category] = [];
            }
            categorizedLearnings[learning.category].push(learning.content);
        } else {
            uncategorized.push(learning.content);
        }
    });

    const allLogsText = learnings.map(l => `- ${l.content}`).join('\n');
    
    let systemPrompt = "";
    let userPrompt = "";
    
    if (mode === 'summary') {
        systemPrompt = `You are an expert learning analyst. Create an engaging, personalized summary of the user's weekly learning journey.

Your response should:
- Be encouraging and positive
- Highlight key themes and patterns
- Connect related concepts
- Suggest areas for deeper exploration
- Use emojis appropriately
- Be conversational and motivating
- Keep it to 2-3 short paragraphs

Format as plain text (no markdown headers).`;

        userPrompt = `Analyze these learning entries from the past week and create an insightful summary:\n\n${allLogsText}`;
        
    } else if (mode === 'quiz') {
        systemPrompt = `You are a skilled educator creating personalized quiz questions. Generate exactly 3 multiple-choice questions based on the user's learning entries.

Requirements:
- Questions should test understanding, not just memory
- Include mix of difficulty levels
- Each question has exactly 3 options (A, B, C)
- Don't reveal the correct answers
- Make questions engaging and practical
- Use clear, concise language

Format:
**Question 1:** [question text]
A) [option]
B) [option] 
C) [option]

**Question 2:** [question text]
A) [option]
B) [option]
C) [option]

**Question 3:** [question text]
A) [option]
B) [option]
C) [option]`;

        userPrompt = `Create 3 quiz questions based on these learning entries:\n\n${allLogsText}`;
        
    } else if (mode === 'insights') {
        systemPrompt = `You are a learning analytics expert. Provide actionable insights about the user's learning patterns and suggest improvements.

Your response should:
- Identify learning patterns and trends
- Suggest optimization strategies
- Recommend related topics to explore
- Give specific, actionable advice
- Be encouraging but honest
- Use bullet points for clarity

Keep it practical and motivating.`;

        userPrompt = `Provide learning insights based on these entries:\n\n${allLogsText}`;
    }

    return callOpenRouter(
        "qwen/qwen-coder-plus", // Using the better model for analysis
        userPrompt,
        process.env.OPENROUTER_API_KEY_SLOW,
        systemPrompt,
        { temperature: 0.6, maxTokens: 400 }
    );
}

// Generate learning recommendations based on user's history
async function generateRecommendations(learnings, preferences = {}) {
    if (!learnings || learnings.length === 0) {
        return "🎯 Start logging your daily learnings, and I'll suggest related topics and resources to explore!";
    }

    const recentLearnings = learnings.slice(0, 10); // Last 10 learnings
    const learningText = recentLearnings.map(l => `- ${l.content}`).join('\n');

    const systemPrompt = `You are a knowledgeable learning advisor. Based on the user's recent learning history, suggest 3-4 related topics they might find interesting to explore next.

Your recommendations should:
- Build naturally on what they've already learned
- Include a mix of complementary and adjacent topics
- Be specific and actionable
- Include brief explanations of why each topic is relevant
- Be encouraging and inspiring

Format as a bulleted list with brief explanations.`;

    const userPrompt = `Based on these recent learnings, what related topics would you recommend exploring next?\n\n${learningText}`;

    return callOpenRouter(
        "qwen/qwen-coder-plus",
        userPrompt,
        process.env.OPENROUTER_API_KEY_SLOW,
        systemPrompt,
        { temperature: 0.7, maxTokens: 350 }
    );
}

// Generate motivational messages for streaks and achievements
async function generateMotivationalMessage(type, data = {}) {
    const messages = {
        'streak_milestone': [
            `🔥 ${data.streak} days of continuous learning! You're building an incredible knowledge foundation.`,
            `🌟 ${data.streak}-day learning streak! Your commitment to growth is inspiring.`,
            `🚀 ${data.streak} days in a row! You're proving that consistent learning creates extraordinary results.`
        ],
        'goal_achieved': [
            `🎯 Daily goal smashed! You've logged ${data.count} learnings today. Keep up the momentum!`,
            `✅ Goal achieved! ${data.count} learnings today shows your dedication to growth.`,
            `🏆 Another day, another goal conquered! ${data.count} learnings and counting.`
        ],
        'weekly_completion': [
            `📚 What a week! ${data.count} new learnings added to your knowledge collection.`,
            `🌱 Your learning garden grew by ${data.count} entries this week. Amazing progress!`,
            `📈 Week complete: ${data.count} learnings logged. You're building something incredible!`
        ],
        'comeback': [
            `👋 Welcome back! Ready to continue your learning journey?`,
            `🌟 Great to see you again! What new discoveries await today?`,
            `📚 Back to learning! Your future self will thank you for this commitment.`
        ]
    };

    const typeMessages = messages[type] || messages['comeback'];
    return typeMessages[Math.floor(Math.random() * typeMessages.length)];
}

// Analyze learning content to suggest categories
async function suggestCategory(content) {
    const systemPrompt = `You are a content categorizer. Based on the learning content provided, suggest the most appropriate category from this list:

Categories:
- Tech/Programming
- Science
- Language
- Creative/Art
- Business
- Health/Fitness
- General

Respond with ONLY the category name, nothing else.`;

    try {
        const suggestion = await callOpenRouter(
            "mistralai/mistral-7b-instruct",
            content,
            process.env.OPENROUTER_API_KEY_FAST,
            systemPrompt,
            { temperature: 0.3, maxTokens: 20 }
        );
        
        // Validate the response is one of our categories
        const validCategories = ['Tech/Programming', 'Science', 'Language', 'Creative/Art', 'Business', 'Health/Fitness', 'General'];
        return validCategories.includes(suggestion.trim()) ? suggestion.trim() : null;
        
    } catch (error) {
        console.error('Error suggesting category:', error);
        return null;
    }
}

// Generate learning path suggestions
async function generateLearningPath(topic, level = 'beginner') {
    const systemPrompt = `You are an expert curriculum designer. Create a progressive learning path for the given topic.

Provide:
- 5-7 learning steps in logical order
- Brief description for each step
- Estimated time commitment
- Resources or methods for each step

Keep it practical and achievable. Format as a numbered list.`;

    const userPrompt = `Create a ${level} learning path for: ${topic}`;

    return callOpenRouter(
        "qwen/qwen-coder-plus",
        userPrompt,
        process.env.OPENROUTER_API_KEY_SLOW,
        systemPrompt,
        { temperature: 0.6, maxTokens: 500 }
    );
}

module.exports = {
    generateFollowUpQuestion,
    generateWeeklyAnalysis,
    generateRecommendations,
    generateMotivationalMessage,
    suggestCategory,
    generateLearningPath,
    callOpenRouter // Export for potential custom use
};