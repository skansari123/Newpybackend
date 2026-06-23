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
let botStatus = "Initializing...";

async function connectDB() {
    if (dbCollection) return dbCollection;
    try {
        const client = await MongoClient.connect(MONGO_URL);
        const db = client.db('chatbot_database');
        dbCollection = db.collection('brain_data');
        console.log("MongoDB Connected! 🎉");
        return dbCollection;
    } catch (err) {
        botStatus = "MongoDB Error: " + err.message;
        throw err;
    }
}

// 🟢 QR Code UI Route
app.get('/whatsapp-qr', (req, res) => {
    if (qrCodeString) {
        qrcode.toDataURL(qrCodeString, (err, url) => {
            if (err) return res.send("QR Code error.");
            return res.send(`
                <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                    <h2 style="color: #25D366;">📱 Apne Mobile WhatsApp se Scan Karo</h2>
                    <p>Apne phone mein WhatsApp kholo -> Settings -> Linked Devices -> Link a Device par jaakar is QR ko scan karo.</p>
                    <div style="margin: 20px 0;">
                        <img src="${url}" style="border: 3px solid #25D366; padding:15px; border-radius:12px;" />
                    </div>
                    <button onclick="window.location.reload()" style="padding:10px 20px; background:#25D366; color:white; border:none; border-radius:5px; cursor:pointer;">🔄 Refresh Status</button>
                </div>
            `);
        });
    } else {
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Status: ${botStatus}</h2>
                <p>Agar connection loop mein hai, toh 10-15 seconds baad page refresh karein.</p>
                <button onclick="window.location.reload()" style="padding:10px 20px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer;">🔄 Refresh Page</button>
            </div>
        `);
    }
});

// UI Live Content Route
app.get('/api/db-content', async (req, res) => {
    try {
        const collection = await connectDB();
        const currentData = await collection.findOne({ _id: "bot_brain" });
        return res.json({ content: currentData ? currentData.text : "" });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

app.post('/api/db-update', async (req, res) => {
    try {
        const collection = await connectDB();
        await collection.updateOne({ _id: "bot_brain" }, { $set: { text: req.body.text } }, { upsert: true });
        return res.json({ success: "Updated!" });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});

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

async function askGroqAI(userMsg, knowledgeBase) {
    if (!knowledgeBase || knowledgeBase.trim() === "") return "Database khali hai bhai.";
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: `Tum ek obedient AI assistant ho. Is base par jawab do: ${knowledgeBase}` },
                    { role: "user", content: userMsg }
                ],
                temperature: 0.2
            })
        });
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (err) { return "AI busy hai abhi."; }
}

// 🔥 WhatsApp Engine
async function startWhatsApp() {
    try {
        // Local files ke bajaye memory auth use karenge rate limit se bachne ke liye
        const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session_dir');
        const initSocket = makeWASocket.default || makeWASocket;
        
        sock = initSocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeString = qr;
                botStatus = "QR Code Ready! Scan Karo.";
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                qrCodeString = "";
                botStatus = `Disconnected. Retrying in 10s...`;
                if (shouldReconnect) {
                    setTimeout(() => startWhatsApp(), 10000); // 10 second ka delay taaki block na ho
                }
            } else if (connection === 'open') {
                botStatus = "Connected and Active! 🎉";
                qrCodeString = "";
                console.log('✅ WhatsApp Connected!');
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            if (from.endsWith('@g.us')) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!text) return;

            try {
                const collection = await connectDB();
                const currentData = await collection.findOne({ _id: "bot_brain" });
                const kb = currentData ? currentData.text : "";
                const botReply = await askGroqAI(text, kb);
                await sock.sendMessage(from, { text: botReply }, { quoted: msg });
            } catch (e) { console.error(e); }
        });

    } catch (e) {
        botStatus = "Error: " + e.message;
    }
}

startWhatsApp();
app.get('/', (req, res) => { res.send("Running. Status: " + botStatus); });
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Port ${PORT}`));
