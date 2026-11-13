import { PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildBasedChannel } from 'discord.js';
import { config } from './config.js';

export function userCanPostInChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  channel: GuildBasedChannel,
): boolean {
  if (!config.enforceChannelPermissions) return true;
  const perms = channel.permissionsFor(interaction.member);
  return perms?.has(PermissionFlagsBits.SendMessages) ?? false;
}
