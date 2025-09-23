require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');

const PREFIX = "/";
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const app = express();
const PORT = process.env.PORT || 3000;

const sessions = {}; // discordUserId => sock
const qrStore = {};  // discordUserId => dernier QR

// --- Fonction pour créer/recharger une session WhatsApp ---
async function startSession(userId) {
    const sessionPath = path.join(__dirname, 'sessions', userId);
    await fs.ensureDir(sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrStore[userId] = qr; // stocke le QR
            console.log(`📲 Nouveau QR pour ${userId}`);
        }

        if (connection === 'open') {
            sessions[userId] = sock;
            delete qrStore[userId];
            console.log(`✅ Session WhatsApp ouverte pour ${userId}`);
        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Session ${userId} fermée. Raison:`, reason);
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => startSession(userId).catch(console.error), 2000);
            } else {
                delete sessions[userId];
                delete qrStore[userId];
                await fs.remove(sessionPath);
                console.log(`❌ Session ${userId} supprimée définitivement (logged out).`);
            }
        }
    });

    return sock;
}

// --- Page HTML pour connecter WhatsApp par utilisateur ---
app.get('/', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.send("<h3 style='color:red;'>⚠️ userId manquant dans l'URL.</h3>");

    res.send(`
    <html>
      <head>
        <meta charset="utf-8">
        <title>Connexion WhatsApp</title>
        <style>
          body { font-family:sans-serif; text-align:center; margin-top:50px; background:#0f172a; color:#00ffae; }
          img { margin-top:20px; border:4px solid #00ffae; border-radius:12px; width:300px; height:300px; }
        </style>
      </head>
      <body>
        <h2>Connectez votre WhatsApp</h2>
        <p>Scannez le QR code ci-dessous avec votre WhatsApp.</p>
        <img id="qr" src="" />
        <p id="status"></p>
        <script>
          async function fetchQR() {
            try {
              const res = await fetch('/qr-data?userId=${userId}');
              const data = await res.json();
              const img = document.getElementById('qr');
              const status = document.getElementById('status');
              if (data.qr) {
                img.src = data.qr;
                img.style.display = "block";
                status.innerText = "📲 Scannez le QR";
              } else {
                img.style.display = "none";
                status.innerText = "✅ Déjà connecté";
              }
            } catch(err){ console.error(err); }
          }
          fetchQR();
          setInterval(fetchQR, 5000);
        </script>
      </body>
    </html>
    `);
});

// --- Endpoint pour renvoyer le QR en JSON ---
app.get('/qr-data', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "userId manquant" });

    const qr = qrStore[userId];
    if (!qr) return res.json({ qr: null });

    try {
        const qrImage = await qrcode.toDataURL(qr);
        res.json({ qr: qrImage });
    } catch {
        res.json({ qr: null });
    }
});

// --- Dashboard live ---
app.get('/dashboard', (req, res) => {
    res.send(`
    <html>
      <head>
        <meta charset="utf-8">
        <title>Dashboard WhatsApp Live</title>
        <style>
          body { font-family:sans-serif; background:#0f172a; color:#00ffae; padding:20px; }
          table { border-collapse:collapse; width:100%; }
          th, td { border:1px solid #00ffae; padding:8px; text-align:center; }
          img { width:120px; height:120px; }
        </style>
      </head>
      <body>
        <h2>Dashboard WhatsApp Live - Sessions Utilisateurs</h2>
        <table>
          <thead>
            <tr>
              <th>Discord ID</th>
              <th>Statut</th>
              <th>QR Code</th>
            </tr>
          </thead>
          <tbody id="dashboardBody"></tbody>
        </table>

        <script>
          async function fetchDashboard() {
            try {
              const res = await fetch('/dashboard-data');
              const data = await res.json();
              const tbody = document.getElementById('dashboardBody');
              tbody.innerHTML = '';

              for(const userId of Object.keys(data)) {
                const { status, qr } = data[userId];
                const qrHtml = qr ? '<img src="' + qr + '" />' : '-';
                tbody.innerHTML += \`
                  <tr>
                    <td>\${userId}</td>
                    <td>\${status}</td>
                    <td>\${qrHtml}</td>
                  </tr>
                \`;
              }
            } catch(err) { console.error(err); }
          }

          fetchDashboard();
          setInterval(fetchDashboard, 5000);
        </script>
      </body>
    </html>
    `);
});

// Endpoint JSON pour dashboard live
app.get('/dashboard-data', async (req, res) => {
    const data = {};
    for(const userId of Object.keys(sessions).concat(Object.keys(qrStore))) {
        const status = sessions[userId] ? "✅ Connecté" : "⚠️ Pas connecté";
        let qrImage = null;
        if(qrStore[userId]) {
            try { qrImage = await qrcode.toDataURL(qrStore[userId]); } catch { qrImage = null; }
        }
        data[userId] = { status, qr: qrImage };
    }
    res.json(data);
});

// --- Discord Bot ---
client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;
    const userId = msg.author.id;

    if (msg.content === "/connect") {
        const link = `https://py-bot-v2.onrender.com/?userId=${userId}`;
        return msg.reply(`Clique sur ce lien pour connecter ton WhatsApp : ${link}`);
    }

    if (msg.content === "/status") {
        return msg.reply(sessions[userId] ? "✅ Connecté à WhatsApp." : "❌ Pas connecté.");
    }

    if (msg.content === "/disconnect") {
        if (sessions[userId]) {
            try { sessions[userId].ws?.close(); } catch {}
            delete sessions[userId];
            delete qrStore[userId];
            return msg.reply("🔌 Déconnecté.");
        } else return msg.reply("⚠️ Pas connecté.");
    }

    if (msg.content === "/ping") {
        const latency = Date.now() - msg.createdTimestamp;
        return msg.reply(`🏓 Pong ! Latence ≈ ${latency}ms`);
    }
});

// --- Lancement ---
client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`🚀 Serveur web démarré sur le port ${PORT}`));