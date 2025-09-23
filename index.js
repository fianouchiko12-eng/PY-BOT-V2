require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const { default: makeWASocket, useMultiFileAuthState } = require('baileys');
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

// --- Commandes modulaires ---
const commands = new Map();
const commandFolder = path.join(__dirname, "commands");
if (!fs.existsSync(commandFolder)) fs.mkdirSync(commandFolder);

function loadCommands() {
    commands.clear();
    fs.readdirSync(commandFolder)
      .filter(f => f.endsWith('.js'))
      .forEach(file => {
        const cmd = require(path.join(commandFolder, file));
        commands.set(cmd.name, cmd);
    });
}
loadCommands();

// --- Serveur web ---
app.use(express.static('public'));

app.get('/qr/:userId', async (req, res) => {
    const userId = req.params.userId;
    const sessionPath = `./sessions/${userId}`;
    await fs.ensureDir(sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            sessions[userId] = sock;
        }
    });

    // On récupère le QR et on l’affiche
    sock.ev.once('connection.update', async ({ qr }) => {
        if (qr) {
            const qrImage = await qrcode.toDataURL(qr);
            res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
                if (!err) {
                    // Injecte QR code dans HTML
                    res.write(`
                        <script>
                            document.getElementById('qr').src = "${qrImage}";
                        </script>
                    `);
                    res.end();
                }
            });
        } else res.send("❌ QR code introuvable.");
    });
});

// --- Discord ---
client.on('messageCreate', async (msg) => {
    const userId = msg.author.id;

    // Commandes système
    if (msg.content === "/connect") {
        const link = `https://py-bot-v2.onrender.com/qr/${userId}`;
        return msg.reply(`Clique sur ce lien pour connecter ton WhatsApp : ${link}`);
    }

    if (msg.content === "/status") {
        return msg.reply(sessions[userId] ? "✅ Connecté à WhatsApp." : "❌ Pas connecté.");
    }

    if (msg.content === "/disconnect") {
        if (sessions[userId]) {
            sessions[userId].end();
            delete sessions[userId];
            return msg.reply("🔌 Déconnecté.");
        } else return msg.reply("⚠️ Pas connecté.");
    }

    // Commandes personnalisées
    if (!msg.content.startsWith(PREFIX)) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    if (!commands.has(commandName)) return;
    const command = commands.get(commandName);

    try {
        await command.run({ msg, args, sessions });
    } catch (err) {
        console.error(`[ERREUR] Commande "${commandName}" :`, err);
        msg.reply("❌ Une erreur est survenue lors de l’exécution de la commande.");
    }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => console.log(`Web server started on port ${PORT}`));
