module.exports = {
    name: "help",
    description: "Instructions Psycho Bot",
    run: async ({ msg }) => {
        await msg.reply(`
📌 Instructions Psycho Bot :

1️⃣ /connect → Génère ton lien de connexion WhatsApp
2️⃣ /status → Vérifie si tu es connecté
3️⃣ /disconnect → Déconnecte ton WhatsApp
4️⃣ /ping → Vérifie si le bot répond
5️⃣ /echo <message> → Répète ton message
        `);
    }
};
