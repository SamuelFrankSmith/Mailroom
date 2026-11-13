import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { unlinkSync } from 'node:fs';
import {
  deleteItem,
  getItemById,
  getItemsForMailbox,
  getMailbox,
  getMailboxById,
  setMailboxRandomize,
} from '../database/db.js';
import type { Item, Mailbox } from '../types.js';
import { ids, parseCustomId } from '../ui/customIds.js';
import type { Command } from './types.js';

const MAX_BUTTONS = 20;

function buildInspectContent(
  mailbox: Mailbox,
  items: Item[],
  channelName: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const displayItems = items.slice(0, MAX_BUTTONS);

  let description: string;
  if (items.length === 0) {
    description = '*No items in this mailbox.*';
  } else {
    description = items
      .map((item, i) => {
        const num = `**${i + 1}.**`;
        const dateTag = item.scheduledDate ? ` *(pinned: ${item.scheduledDate})*` : '';
        if (item.type === 'text') {
          const preview = item.content.length > 150 ? item.content.slice(0, 150) + '…' : item.content;
          return `${num} ${preview}${dateTag}`;
        }
        const icon = item.type === 'image' ? '🖼️' : '📄';
        return `${num} ${icon} \`${item.filename ?? 'file'}\`${dateTag}`;
      })
      .join('\n');

    if (items.length > MAX_BUTTONS) {
      description += `\n\n*${items.length - MAX_BUTTONS} more item(s) — delete some to see delete buttons for them.*`;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`#${channelName}`)
    .setDescription(description)
    .setFooter({
      text: `${items.length} item${items.length === 1 ? '' : 's'} · Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`,
    });

  // Up to 4 rows of delete buttons (5 per row = 20 total), plus 1 row for randomize toggle
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let rowIdx = 0; rowIdx < Math.ceil(displayItems.length / 5); rowIdx++) {
    const rowItems = displayItems.slice(rowIdx * 5, rowIdx * 5 + 5);
    const buttons: ButtonBuilder[] = rowItems.map((item, btnIdx) =>
      new ButtonBuilder()
        .setCustomId(ids.inspect.delete(item.id))
        .setLabel(`🗑 #${rowIdx * 5 + btnIdx + 1}`)
        .setStyle(ButtonStyle.Danger),
    );
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));
  }

  const randomizeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.inspect.randomize(mailbox.id))
      .setLabel(`🔀 Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`)
      .setStyle(mailbox.randomize ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  rows.push(randomizeRow);

  return { embeds: [embed], components: rows };
}

export const inspect: Command = {
  data: new SlashCommandBuilder()
    .setName('inspect')
    .setDescription('View and manage items in your mailbox for a channel')
    .setDMPermission(false)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('The channel whose mailbox to inspect')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const channel = interaction.options.getChannel('channel', true);
    const mailbox = getMailbox(interaction.user.id, channel.id);

    if (!mailbox) {
      await interaction.reply({
        content: `❌ No mailbox for <#${channel.id}>. Use \`/establish-mailbox\` first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const items = getItemsForMailbox(mailbox.id);
    const channelName = channel.name;
    const { embeds, components } = buildInspectContent(mailbox, items, channelName);

    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  },
};

export async function handleInspectComponent(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const { action, args } = parseCustomId(interaction.customId);

  if (action === 'del') {
    const itemId = parseInt(args[0] ?? '', 10);
    if (isNaN(itemId)) return;

    const item = getItemById(itemId);
    if (!item) {
      // Already gone — just refresh the view
      await refreshInspectView(interaction);
      return;
    }

    // Verify ownership
    const mailbox = getMailboxById(item.mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id) {
      await interaction.reply({ content: '❌ You do not own that item.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (item.type !== 'text') {
      try { unlinkSync(item.content); } catch { /* file already gone */ }
    }
    deleteItem(itemId);
    await refreshInspectView(interaction, mailbox.id, mailbox.channelId);
    return;
  }

  if (action === 'rand') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    if (isNaN(mailboxId)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id) {
      await interaction.reply({ content: '❌ You do not own that mailbox.', flags: MessageFlags.Ephemeral });
      return;
    }

    setMailboxRandomize(mailboxId, !mailbox.randomize);
    await refreshInspectView(interaction, mailboxId, mailbox.channelId);
    return;
  }
}

async function refreshInspectView(
  interaction: ButtonInteraction<'cached'>,
  mailboxId?: number,
  channelId?: string,
): Promise<void> {
  // Resolve mailbox — from explicit ID or by re-parsing the existing embed
  let mailbox: Mailbox | undefined;
  let chId = channelId;

  if (mailboxId !== undefined) {
    mailbox = getMailboxById(mailboxId);
  }

  if (!mailbox) {
    await interaction.update({ content: '❌ Mailbox not found.', embeds: [], components: [] });
    return;
  }

  if (!chId) chId = mailbox.channelId;

  const channelObj = interaction.guild.channels.cache.get(chId);
  const channelName = channelObj && 'name' in channelObj ? String(channelObj.name) : chId;

  const items = getItemsForMailbox(mailbox.id);
  const { embeds, components } = buildInspectContent(mailbox, items, channelName);
  await interaction.update({ embeds, components });
}
