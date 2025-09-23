module.exports = {
    name: "echo",
    description: "Répète ton message",
    run: async ({ msg, args }) => {
        const text = args.join(" ");
        if (!text) return msg.reply("❌ Donne un texte à répéter.");
        await msg.reply(`🗣️ ${text}`);
    }
};

