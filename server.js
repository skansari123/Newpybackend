import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';

const { Client, LocalAuth } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

let dbCollection;
let qrCodeString = ""; 

// Database Connection
async function connectDB() {
    if (dbCollection) return dbCollection;
    try {
        const client = await MongoClient.connect(MONGO_URL);
        const db = client.db('chatbot_database');
        dbCollection = db.collection('brain_data');
        console.log("MongoDB Connected Successfully! 🎉");
        return dbCollection;
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
        throw err;
    }
}

// 🟢 QR Code dekhne ke liye URL Route
app.get('/whatsapp-qr', (req, res) => {
    if (!qrCodeString) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Wait karo bhai... ⏳</h2>
                <p>QR Code generate ho raha hai ya fir aapka WhatsApp pehle se connected hai.</p>
                <button onclick="window.location.reload()" style="padding:10px 20px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer;">🔄 Check Again</button>
            </div>
        `);
    }
    
    qrcode.toDataURL(qrCodeString, (err, url) => {
        if (err) return res.send("QR Code image banane mein dikkat aayi.");
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2 style="color: #25D366;">📱 Apne WhatsApp se Scan Karo</h2>
                <div style="margin: 20px 0;">
                    <img src="${url}" style="border: 3px solid #25D366; padding:15px; border-radius:12px; background:white; box-shadow:0 4px 10px rgba(0,0,0,0.1);" />
                </div>
                <p style="color:#555; max-width:400px; margin:0 auto; line-height:1.5;">
                    WhatsApp open karein -> Settings -> Linked Devices -> Link a Device par click karke scan karein. Scan hote hi aapka bot pure time automatic reply karega!
                </p>
            </div>
        `);
    });
});

// UI Live Content Route
app.get('/api/db-content', async (req, res) => {
    try {
        const collection = await connectDB();
        const currentData = await collection.findOne({ _id: "bot_brain" });
        return res.json({ content: currentData ? currentData.text : "" });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

// Full DB Update/Edit Route
app.post('/api/db-update', async (req, res) => {
    try {
        const collection = await connectDB();
        await collection.updateOne({ _id: "bot_brain" }, { $set: { text: req.body.text } }, { upsert: true });
        return res.json({ success: "Updated!" });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

// Web UI Post/Chat Route
app.post('/api/chat', async (req, res) => {
    try {
        const { action, text_info, message } = req.body;
        const collection = await connectDB();
        if (action === "upload") {
            const currentData = await collection.findOne({ _id: "bot_brain" });
            let updatedText = currentData && currentData.text ? currentData.text + "\n" + text_info : text_info;
            await collection.updateOne({ _id: "bot_brain" }, { $set: { text: updatedText } }, { upsert: true });
            return res.json({ success: "Saved!" });
        } else if (action === "ask") {
            const currentData = await collection.findOne({ _id: "bot_brain" });
            const reply = await askGroqAI(message, currentData ? currentData.text : "");
            return res.json({ reply });
        }
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

// 🤖 Core AI Engine (Groq AI)
async function askGroqAI(userMsg, knowledgeBase) {
    if (!knowledgeBase || knowledgeBase.trim() === "") {
        return "Mujhe afsos hai, mere database mein abhi koi jankari nahi hai.";
    }
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `Tum ek bohot hi polite, respectful aur obedient AI assistant ho. 
                        Strict Rule 1: Tumhe sirf aur sirf is KNOWLEDGE_BASE ke adhar par jawab dena hai: ${knowledgeBase}.
                        Strict Rule 2: User jis language (Hindi, English, ya Hinglish) mein sawaal puche, tumhe bilkul usi language aur tone mein bohot tameez aur namrata se jawab dena hai.
                        Strict Rule 3: Agar sawaal ka jawab KNOWLEDGE_BASE mein na ho, toh usi language mein politely bolo ki aapko iski jankari nahi hai.`
                    },
                    { role: "user", content: userMsg }
                ],
                temperature: 0.2
            })
        });
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (err) { 
        console.error("Groq Fetch Error:", err);
        return "Afsos, mai abhi server load ki wajah se jawab nahi de paunga."; 
    }
}

// ==========================================
// 🔥 WHATSAPP ENGINE SETUP 🔥
// ==========================================
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Jab QR ready hoga
whatsappClient.on('qr', (qr) => {
    console.log("👉 New QR Code Generated!");
    qrCodeString = qr; 
});

// Jab login kamiyab ho jaye
whatsappClient.on('ready', () => {
    console.log("✅ WhatsApp Bot Ekdam Live Aur Ready Hai!");
    qrCodeString = ""; 
});

// Jab WhatsApp par naya message aaye
whatsappClient.on('message', async (msg) => {
    // Sirf individual chats ka jawab dene ke liye (Groups ko ignore karne ke liye)
    if (msg.from.includes('@g.us')) return;

    try {
        const collection = await connectDB();
        const currentData = await collection.findOne({ _id: "bot_brain" });
        const kb = currentData ? currentData.text : "";

        // Groq AI se answer ready karwao
        const botReply = await askGroqAI(msg.body, kb);
        
        // Samne wale ko automatic send karo
        await msg.reply(botReply);
    } catch (error) {
        console.error("Error processing WhatsApp message:", error);
    }
});

// Init WhatsApp
whatsappClient.initialize();

app.get('/', (req, res) => { res.send("System is up! Backend aur WhatsApp dono active hain. 🚀"); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
