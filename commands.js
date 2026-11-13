const { SlashCommandBuilder } = require('discord.js');

module.exports = [
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder().setName('help').setDescription('View all LCDOT commands'),
    new SlashCommandBuilder().setName('setup-panels').setDescription('Deploy the interactive employee panels'),
    
    // Roster Management
    new SlashCommandBuilder().setName('roster').setDescription('View the full department roster'),
    new SlashCommandBuilder().setName('roster-view').setDescription('View a specific member profile').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)),
    new SlashCommandBuilder().setName('roster-search').setDescription('Search for a member').addStringOption(opt => opt.setName('query').setDescription('Discord ID or Username').setRequired(true)),
    new SlashCommandBuilder().setName('roster-loa').setDescription('Place a member on Leave of Absence').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('roster-return').setDescription('Return a member from LOA').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),

    // Promotions & Shifts
    new SlashCommandBuilder().setName('promote').setDescription('Promote a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('rank').setDescription('New Rank').setRequired(true).addChoices({name: 'Junior Operator', value: 'Junior Operator'}, {name: 'Operator', value: 'Operator'}, {name: 'Senior Operator', value: 'Senior Operator'}, {name: 'Specialist', value: 'Specialist'}, {name: 'Crew Supervisor', value: 'Crew Supervisor'}, {name: 'Field Supervisor', value: 'Field Supervisor'}, {name: 'Management Team', value: 'Management Team'}, {name: 'Executive Board', value: 'Executive Board'})).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('promotion-history').setDescription('View promotion history for a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder().setName('shift').setDescription('Manage your shifts and view shift data'),
    new SlashCommandBuilder().setName('activity').setDescription('View shift activity over a period'),

    // Discipline / Internal Affairs
    new SlashCommandBuilder().setName('discipline-issue').setDescription('Issue a disciplinary action').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addStringOption(opt => opt.setName('action').setDescription('Action type').setRequired(true).addChoices({name: 'Warning', value: 'Warning'}, {name: 'Strike', value: 'Strike'}, {name: 'Suspension', value: 'Suspension'})).addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('discipline-history').setDescription('View disciplinary history for a member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder().setName('discipline-recent').setDescription('View recent disciplinary activity'),

    // FTO Division
    new SlashCommandBuilder().setName('fto-assign').setDescription('Assign an FTO to a trainee').addUserOption(opt => opt.setName('trainee').setDescription('Trainee').setRequired(true)).addUserOption(opt => opt.setName('fto').setDescription('FTO').setRequired(true)),
    new SlashCommandBuilder().setName('fto-start').setDescription('Start a training session'),
    new SlashCommandBuilder().setName('fto-complete').setDescription('Complete a training session').addUserOption(opt => opt.setName('trainee').setDescription('Trainee').setRequired(true)).addStringOption(opt => opt.setName('result').setDescription('Pass or Fail').setRequired(true).addChoices({name: 'Pass', value: 'Pass'}, {name: 'Fail', value: 'Fail'})),
    new SlashCommandBuilder().setName('fto-history').setDescription('View training history for a trainee').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),

    // Applications & Dashboards
    new SlashCommandBuilder().setName('application-list').setDescription('List pending applications'),
    new SlashCommandBuilder().setName('application-review').setDescription('Review an application').addUserOption(opt => opt.setName('user').setDescription('Applicant').setRequired(true)).addStringOption(opt => opt.setName('status').setDescription('Approve or Deny').setRequired(true).addChoices({name: 'Approve', value: 'Approved'}, {name: 'Deny', value: 'Denied'})),
    new SlashCommandBuilder().setName('management-dashboard').setDescription('Deploy the management command center'),
    new SlashCommandBuilder().setName('fto-dashboard').setDescription('Deploy the FTO command center')
].map(cmd => cmd.toJSON());