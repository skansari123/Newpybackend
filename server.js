import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY; 

let dbCollection;
let qrCodeString = ""; 
let sock;

// Database Connection
async function connectDB() {
    if (dbCollection) return dbCollection;
    try {
        const client = await MongoClient.connect(MONGO_URL);
        const db = client.db('chatbot_database');
        dbCollection = db.collection('brain_data');
        console.log("MongoDB Connected! 🎉");
        return dbCollection;
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
        throw err;
    }
}

// 🟢 QR Code UI Route
app.get('/whatsapp-qr', (req, res) => {
    if (!qrCodeString) {
        return res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Wait karo bhai... ⏳</h2>
                <p>QR Code generate ho raha hai ya WhatsApp pehle se connected hai. 10-15 seconds baad page refresh karein.</p>
                <button onclick="window.location.reload()" style="padding:10px 20px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer;">🔄 Refresh</button>
            </div>
        `);
    }
    
    qrcode.toDataURL(qrCodeString, (err, url) => {
        if (err) return res.send("QR Code banane mein error aaya.");
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2 style="color: #25D366;">📱 Apne WhatsApp se Scan Karo</h2>
                <div style="margin: 20px 0;">
                    <img src="${url}" style="border: 3px solid #25D366; padding:15px; border-radius:12px; background:white;" />
                </div>
                <p style="color:#555;">Settings -> Linked Devices -> Link a Device par jaakar scan karein.</p>
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

// Full DB Update
app.post('/api/db-update', async (req, res) => {
    try {
        const collection = await connectDB();
        await collection.updateOne({ _id: "bot_brain" }, { $set: { text: req.body.text } }, { upsert: true });
        return res.json({ success: "Updated!" });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

// Web UI Post Chat Route
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

// 🤖 Groq AI Engine
async function askGroqAI(userMsg, knowledgeBase) {
    if (!knowledgeBase || knowledgeBase.trim() === "") return "Mujhe afsos hai, database khali hai.";
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
    } catch (err) { return "Afsos, mai abhi jawab nahi de paunga."; }
}

// ==========================================
// 🔥 LIGHTWEIGHT WHATSAPP ENGINE (BAILEYS) 🔥
// ==========================================
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session');
    
    sock = makeWASocket.default({
        auth: state,
        logger: pino({ level: 'silent' }), // Log band taaki RAM bache
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeString = qr;
            console.log("👉 Baileys QR Code Generated!");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting: ', shouldReconnect);
            qrCodeString = "";
            if (shouldReconnect) startWhatsApp(); // Dobara connect karo agar logout nahi hua toh
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Baileys Bot Ekdam Active Hai!');
            qrCodeString = "";
        }
    });

    // Message milne par
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (from.endsWith('@g.us')) return; // Group messages chhod do

        // Text message nikalna
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        try {
            const collection = await connectDB();
            const currentData = await collection.findOne({ _id: "bot_brain" });
            const kb = currentData ? currentData.text : "";

            const botReply = await askGroqAI(text, kb);

            // WhatsApp Reply Bhejna
            await sock.sendMessage(from, { text: botReply }, { quoted: msg });
        } catch (error) {
            console.error("WhatsApp Send Error:", error);
        }
    });
}

// Initialize WhatsApp
startWhatsApp();

app.get('/', (req, res) => { res.send("System is running fine! 🚀"); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
