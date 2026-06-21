import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

let dbCollection;

async function connectDB() {
    if (dbCollection) return dbCollection;
    try {
        const client = await MongoClient.connect(MONGO_URL);
        const db = client.db('chatbot_database');
        dbCollection = db.collection('brain_data');
        console.log("MongoDB Cloud Connect Ho Gaya! 🎉");
        return dbCollection;
    } catch (err) {
        console.error("Database connection error:", err);
        throw new Error("Database se connection nahi ban pa raha hai.");
    }
}

// 🟢 Naya API Endpoint: Jo database ka saara data frontend ko laakar dega
app.get('/api/db-content', async (req, res) => {
    try {
        const collection = await connectDB();
        const currentData = await collection.findOne({ _id: "bot_brain" });
        const text = currentData && currentData.text ? currentData.text : "Database abhi khali hai! 💨";
        return res.json({ content: text });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send("Bhai backend ekdam mast chal raha hai! 🚀");
});

app.post('/api/chat', async (req, res) => {
    try {
        const { action } = req.body;
        const collection = await connectDB(); 

        if (action === "upload") {
            const { text_info } = req.body;
            if (!text_info) return res.status(400).json({ error: "Text khali hai!" });

            const currentData = await collection.findOne({ _id: "bot_brain" });
            let updatedText = text_info;

            if (currentData && currentData.text) {
                updatedText = currentData.text + " \n " + text_info;
            }

            await collection.updateOne(
                { _id: "bot_brain" },
                { $set: { text: updatedText } },
                { upsert: true }
            );

            return res.json({ success: "Data permanent save ho gaya! 🎉" });
        }

        else if (action === "ask") {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: "Sawaal khali hai!" });

            const currentData = await collection.findOne({ _id: "bot_brain" });
            const knowledgeBase = currentData && currentData.text ? currentData.text : "";

            if (!knowledgeBase) {
                return res.json({ reply: "Mujhe afsos hai, database khali hai." });
            }

            if (!GROQ_API_KEY) {
                return res.status(500).json({ error: "Groq API Key missing!" });
            }

            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        {
                            role: "system",
                            content: `Tum ek obedient assistant ho. Is KNOWLEDGE_BASE ke adhar par jawab do: ${knowledgeBase}. Agar sawaal isme na ho, toh strictly bolo: "Mujhe afsos hai, mere database mein iski jankari nahi hai."`
                        },
                        { role: "user", content: message }
                    ],
                    temperature: 0.0
                })
            });

            const groqData = await response.json();
            if (groqData.error) return res.status(400).json({ error: groqData.error.message });

            return res.json({ reply: groqData.choices[0].message.content });
        }
        return res.status(400).json({ error: "Galat action!" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
