module.exports = {
    name: "ping",
    description: "Répond Pong!",
    run: async ({ msg }) => {
        await msg.reply("🏓 Pong!");
    }
};
