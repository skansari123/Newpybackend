import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;
const GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

let dbCollection;

MongoClient.connect(MONGO_URL)
  .then(client => {
    const db = client.db('chatbot_database');
    dbCollection = db.collection('brain_data');
    console.log("MongoDB Cloud Connect Ho Gaya! 🎉");
  })
  .catch(err => console.error("Database connection error:", err));

app.get('/', (req, res) => {
    res.send("Bhai backend ekdam mast chal raha hai! 🚀");
});

app.post('/api/chat', async (req, res) => {
    try {
        const { action } = req.body;

        if (action === "upload") {
            const { text_info } = req.body;
            if (!text_info) return res.status(400).json({ error: "Text khali hai!" });

            const currentData = await dbCollection.findOne({ _id: "bot_brain" });
            const oldText = currentData ? currentData.text : "";
            const updatedText = oldText + " \n " + text_info;

            await dbCollection.updateOne(
                { _id: "bot_brain" },
                { $set: { text: updatedText } },
                { upsert: true }
            );
            return res.json({ success: "Data MongoDB Cloud mein permanent save ho gaya! 🎉" });
        }

        else if (action === "ask") {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: "Sawaal khali hai!" });

            const currentData = await dbCollection.findOne({ _id: "bot_brain" });
            const knowledgeBase = currentData ? currentData.text : "Koi jankari nahi mili.";

            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama3-8b-8192",
                    messages: [
                        {
                            role: "system",
                            content: `Tum ek obedient AI ho. Sirf is KNOWLEDGE_BASE ke hisab se jawab do: ${knowledgeBase}. Agar sawaal isme na ho, toh strictly bolo: "Mujhe afsos hai, mere database mein iski jankari nahi hai."`
                        },
                        { role: "user", content: message }
                    ],
                    temperature: 0.0
                })
            });

            const groqData = await response.json();
            const reply = groqData.choices[0].message.content;
            return res.json({ reply: reply });
        }

        return res.status(400).json({ error: "Galat action!" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
