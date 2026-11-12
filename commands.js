const { SlashCommandBuilder } = require('discord.js');

module.exports = [
    // Core
    new SlashCommandBuilder().setName('help').setDescription('View all LCDOT commands'),
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    
    // Shifts
    new SlashCommandBuilder().setName('clockin').setDescription('Start your shift').addStringOption(opt => opt.setName('type').setDescription('Board or Division').setRequired(true).addChoices({name: 'Ranked Board', value: 'Ranked Board'}, {name: 'Supervisory Board', value: 'Supervisory Board'}, {name: 'HOD', value: 'HOD'}, {name: 'COD', value: 'COD'}, {name: 'CCD', value: 'CCD'}, {name: 'FTO', value: 'FTO'})),
    new SlashCommandBuilder().setName('clockout').setDescription('End your shift'),
    new SlashCommandBuilder().setName('shift-stats').setDescription('View your weekly and total hours'),
    new SlashCommandBuilder().setName('on-duty').setDescription('View all active personnel'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('View top weekly hours'),
    
    // Roster & Profile
    new SlashCommandBuilder().setName('profile').setDescription('View a member profile').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)),
    new SlashCommandBuilder().setName('roster').setDescription('View the full department roster'),
    
    // LOA
    new SlashCommandBuilder().setName('loa-request').setDescription('Request a Leave of Absence').addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('loa-return').setDescription('Return from LOA'),
    
    // Admin & Management
    new SlashCommandBuilder().setName('promote').setDescription('Promote a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('rank').setDescription('New Rank').setRequired(true).addChoices({name: 'Junior Operator', value: 'Junior Operator'}, {name: 'Operator', value: 'Operator'}, {name: 'Senior Operator', value: 'Senior Operator'}, {name: 'Specialist', value: 'Specialist'}, {name: 'Crew Supervisor', value: 'Crew Supervisor'}, {name: 'Field Supervisor', value: 'Field Supervisor'}, {name: 'Management Team', value: 'Management Team'}, {name: 'Executive Board', value: 'Executive Board'})).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('suspend').setDescription('Suspend a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('reinstate').setDescription('Reinstate a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder().setName('reset-shifts').setDescription('Reset all weekly hours (Exec Only)'),
    new SlashCommandBuilder().setName('announce').setDescription('Send an announcement to Discord and Website').addStringOption(opt => opt.setName('title').setDescription('Title').setRequired(true)).addStringOption(opt => opt.setName('message').setDescription('Message').setRequired(true)),

    // Division Apps
    new SlashCommandBuilder().setName('app-approve').setDescription('Approve a divisional app').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('division').setDescription('Division').setRequired(true).addChoices({name: 'HOD', value: 'HOD'}, {name: 'COD', value: 'COD'}, {name: 'CCD', value: 'CCD'}, {name: 'FTO', value: 'FTO'})),
    new SlashCommandBuilder().setName('app-deny').setDescription('Deny a divisional app').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('division').setDescription('Division').setRequired(true).addChoices({name: 'HOD', value: 'HOD'}, {name: 'COD', value: 'COD'}, {name: 'CCD', value: 'CCD'}, {name: 'FTO', value: 'FTO'}))
].map(cmd => cmd.toJSON());