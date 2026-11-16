const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
require('dotenv').config();

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
bot.commands = new Collection();

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    const commandsArray = [];

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        bot.commands.set(command.data.name, command);
        commandsArray.push(command.data.toJSON());
    }

    bot.once('clientReady', async () => {
        console.log(`✅ Bot logged in as ${bot.user.tag}`);
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        try {
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsArray });
            console.log(`✅ ${commandsArray.length} Slash commands registered.`);
        } catch (error) { console.error(error); }
    });
}

// Handle Slash Commands
bot.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = bot.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction, global.db);
        } catch (error) {
            console.error(`Error in /${interaction.commandName}:`, error);
            const errorMsg = { content: 'There was an error executing this command.', ephemeral: true };
            if (interaction.replied || interaction.deferred) await interaction.followUp(errorMsg);
            else await interaction.reply(errorMsg);
        }
    }

    // Handle Buttons
    if (interaction.isButton()) {
        const db = global.db;
        const customId = interaction.customId;

        if (customId.startsWith('approve_promo_') || customId.startsWith('deny_promo_')) {
            await interaction.deferUpdate(); // Acknowledge click

            const isApprove = customId.startsWith('approve_promo_');
            const requestId = customId.split('_')[2];
            
            const requestData = await db.collection('promotion_requests').findOne({ _id: new ObjectId(requestId) });
            if (!requestData || requestData.status !== 'Pending') {
                return interaction.followUp({ content: '❌ This request has already been processed.', ephemeral: true });
            }

            // Disable buttons on the original message
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('disabled_1').setLabel('Promote').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('disabled_2').setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            if (!isApprove) {
                // --- DENY LOGIC ---
                await db.collection('promotion_requests').updateOne({ _id: new ObjectId(requestId) }, { $set: { status: 'Denied' } });
                
                // Update original message
                await interaction.message.edit({ components: [disabledRow] });

                // Send message to the requester (Pic 4)
                const requester = await interaction.guild.members.fetch(requestData.requesterId);
                const denyMsg = `<@${requestData.requesterId}> your promotion request for <@${requestData.targetId}> was unfortunately **denied**. Please contact your chain of command for further details.`;
                
                try {
                    await requester.send(denyMsg);
                } catch (e) {
                    // Fallback to channel if DMs are closed
                    await interaction.channel.send(denyMsg);
                }
                return;
            }

            // --- APPROVE LOGIC ---
            const rankConfig = {
                "Junior Operator": { level: 1, role: process.env.ROLE_JUNIOR },
                "Operator": { level: 2, role: process.env.ROLE_OPERATOR },
                "Senior Operator": { level: 3, role: process.env.ROLE_SENIOR },
                "Specialist": { level: 4, role: process.env.ROLE_SPECIALIST },
                "Crew Supervisor": { level: 5, role: process.env.ROLE_CREW },
                "Field Supervisor": { level: 6, role: process.env.ROLE_FIELD },
                "Management Team": { level: 7, role: process.env.ROLE_MGMT },
                "Executive Board": { level: 8, role: process.env.ROLE_EXEC }
            };

            const newConfig = rankConfig[requestData.newRank];
            const oldConfig = rankConfig[requestData.oldRank];

            try {
                const targetMember = await interaction.guild.members.fetch(requestData.targetId);
                
                // Swap Roles
                if (oldConfig && oldConfig.role && targetMember.roles.cache.has(oldConfig.role)) {
                    await targetMember.roles.remove(oldConfig.role).catch(console.error);
                }
                if (newConfig && newConfig.role) {
                    await targetMember.roles.add(newConfig.role);
                }

                // Update DB
                await db.collection('promotion_requests').updateOne({ _id: new ObjectId(requestId) }, { $set: { status: 'Approved' } });
                await db.collection('users').updateOne(
                    { id: requestData.targetId }, 
                    { $set: { rank: requestData.newRank, rank_level: newConfig.level } }
                );

                // Update original message
                await interaction.message.edit({ components: [disabledRow] });

                // 1. Send to Promo Channel (Pic 3)
                const promoChannel = await interaction.guild.channels.fetch('1489842457666654338');
                const promoEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('Department Promotion Notice')
                    .setDescription('The following user was promoted within the department, more information can be seen below.')
                    .addFields(
                        { name: 'User', value: `<@${requestData.targetId}>`, inline: false },
                        { name: 'Superior', value: `<@${interaction.user.id}>`, inline: false },
                        { name: 'New Rank', value: requestData.newRank, inline: false },
                        { name: 'Previous Rank', value: requestData.oldRank, inline: false }
                    )
                    .setFooter({ text: 'Lakeview City DOT | Personnel Management' })
                    .setTimestamp();

                const sentMessage = await promoChannel.send({ embeds: [promoEmbed] });
                await sentMessage.react('🎉');

                // 2. Send to Promoted User (Pic 5)
                const userEmbed = new EmbedBuilder()
                    .setColor('#18181b')
                    .setTitle('Department of Transportation | Promotion')
                    .setDescription('The following user has been promoted for their continued dedication. Please review additional information below.')
                    .addFields(
                        { name: 'User', value: `<@${requestData.targetId}>`, inline: false },
                        { name: 'Reason', value: requestData.reason, inline: false },
                        { name: 'New Rank', value: requestData.newRank, inline: false },
                        { name: 'Superior', value: `<@${interaction.user.id}>`, inline: false }
                    )
                    .setTimestamp();
                
                await promoChannel.send({ content: `<@${requestData.targetId}>`, embeds: [userEmbed] });

            } catch (error) {
                console.error("Error processing approval:", error);
                await interaction.followUp({ content: '❌ Failed to assign roles. Check bot permissions and role hierarchy.', ephemeral: true });
            }
        }
    }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

module.exports = bot;