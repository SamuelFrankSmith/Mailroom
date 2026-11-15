import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildBasedChannel } from 'discord.js';
import { config } from './config.js';

export function userCanPostInChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  channel: GuildBasedChannel,
): boolean {
  if (!config.enforceChannelPermissions) return true;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return false;
  }
  return channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.SendMessages) ?? false;
}
