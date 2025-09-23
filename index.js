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
const qrCodes = {}; // discordUserId => qr en base64

// --- Fonction pour créer/recharger une session WhatsApp ---
async function startSession(userId) {
  const sessionPath = `./sessions/${userId}`;
  await fs.ensureDir(sessionPath);

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodes[userId] = await qrcode.toDataURL(qr);
      console.log(`📲 QR généré pour ${userId}`);
    }

    if (connection === 'open') {
      sessions[userId] = sock;
      delete qrCodes[userId];
      console.log(`✅ Session WhatsApp ouverte pour ${userId}`);
    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Session ${userId} fermée. Raison:`, reason);
      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(() => startSession(userId).catch(console.error), 2000);
      } else {
        delete sessions[userId];
        delete qrCodes[userId];
        console.log(`❌ Session ${userId} supprimée (logged out).`);
      }
    }
  });

  return sock;
}

// --- Page principale ---
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><meta charset="utf-8"><title>Connexion WhatsApp</title></head>
      <body style="font-family: sans-serif; text-align: center; margin-top: 50px; background: #0f172a; color: #00ffae;">
        <h2>Connectez votre WhatsApp</h2>
        <p>Scannez le QR code ci-dessous avec votre WhatsApp.</p>
        <img id="qr" src="" alt="QR Code" style="margin-top:20px; border: 4px solid #00ffae; border-radius: 12px;"/>
        <script>
          const params = new URLSearchParams(window.location.search);
          const userId = params.get("userId");
          if (!userId) {
            document.body.innerHTML = "<h3 style='color:red;'>⚠️ userId manquant dans l'URL.</h3>";
          } else {
            fetch('/generate-qr?userId=' + userId)
              .then(r => r.json())
              .then(obj => {
                if (obj.qr) {
                  document.getElementById('qr').src = obj.qr;
                } else {
                  document.body.innerHTML = "<h3 style='color:red;'>❌ Impossible de générer le QR.</h3>";
                }
              })
              .catch(err => {
                console.error(err);
                document.body.innerHTML = "<h3 style='color:red;'>❌ Erreur serveur.</h3>";
              });
          }
        </script>
      </body>
    </html>
  `);
});

// --- API pour générer/retourner le QR ---
app.get('/generate-qr', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId manquant" });

  if (sessions[userId]) {
    return res.json({ message: "✅ Déjà connecté à WhatsApp" });
  }

  if (!qrCodes[userId]) {
    await startSession(userId);
  }

  let attempts = 0;
  const interval = setInterval(() => {
    if (qrCodes[userId]) {
      clearInterval(interval);
      return res.json({ qr: qrCodes[userId] });
    }
    attempts++;
    if (attempts > 10) {
      clearInterval(interval);
      return res.json({ error: "QR non disponible, réessayez." });
    }
  }, 500);
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
      try { sessions[userId].ws?.close(); } catch(e) {}
      delete sessions[userId];
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