import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { upsertMailbox } from '../database/db.js';
import { userCanPostInChannel } from '../permissions.js';
import { computeInitialNextPostAt, validateFrequency } from '../time.js';
import type { Command } from './types.js';

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export const establishMailbox: Command = {
  data: new SlashCommandBuilder()
    .setName('establish-mailbox')
    .setDescription('Create or update your posting mailbox for a channel')
    .setDMPermission(false)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('The channel to post to')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('time')
        .setDescription('Time of day for posts in UTC (HH:mm, 24h). E.g. 09:00, 14:30')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('frequency')
        .setDescription('How often to post. E.g. 1d, 3d, 2w, 4h, 1y')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const channel = interaction.options.getChannel('channel', true);
    const timeStr = interaction.options.getString('time', true).trim();
    const freqRaw = interaction.options.getString('frequency', true).trim().toLowerCase();

    const timeMatch = TIME_RE.exec(timeStr);
    if (!timeMatch) {
      await interaction.reply({
        content: '❌ Invalid time format. Use HH:mm (e.g. `09:00`, `14:30`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const hours = parseInt(timeMatch[1] as string, 10);
    const minutes = parseInt(timeMatch[2] as string, 10);
    if (hours > 23 || minutes > 59) {
      await interaction.reply({
        content: '❌ Invalid time. Hours must be 0–23, minutes 0–59.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const normalizedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    const freqError = validateFrequency(freqRaw);
    if (freqError) {
      await interaction.reply({
        content: `❌ Invalid frequency. Use a number followed by \`h\`, \`d\`, \`w\`, or \`y\`. Examples: \`1d\`, \`3d\`, \`2w\`, \`4h\`, \`1y\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!userCanPostInChannel(interaction, channel)) {
      await interaction.reply({
        content: `❌ You don't have permission to post in <#${channel.id}>. Ask a moderator to set up a mailbox there, or disable \`ENFORCE_CHANNEL_PERMISSIONS\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nextPostAt = computeInitialNextPostAt(normalizedTime, freqRaw, new Date().toISOString());

    upsertMailbox({
      userId: interaction.user.id,
      channelId: channel.id,
      guildId: interaction.guildId,
      frequency: freqRaw,
      postTime: normalizedTime,
      randomize: false,
      nextPostAt,
    });

    const nextTimestamp = Math.floor(new Date(nextPostAt).getTime() / 1000);
    await interaction.reply({
      content: `✅ Mailbox established for <#${channel.id}>.\nFrequency: \`${freqRaw}\` · Next post: <t:${nextTimestamp}:f>`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
