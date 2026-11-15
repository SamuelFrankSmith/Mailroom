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

const PAGE_SIZE = 10;

function buildInspectContent(
  mailbox: Mailbox,
  items: Item[],
  channelName: string,
  page: number,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  let description: string;
  if (items.length === 0) {
    description = '*No items in this mailbox.*';
  } else {
    description = pageItems
      .map((item, i) => {
        const num = `**${clampedPage * PAGE_SIZE + i + 1}.**`;
        const dateTag = item.scheduledDate ? ` *(pinned: ${item.scheduledDate})*` : '';
        if (item.type === 'text') {
          const preview = item.content.length > 150 ? item.content.slice(0, 150) + '…' : item.content;
          return `${num} ${preview}${dateTag}`;
        }
        const icon = item.type === 'image' ? '🖼️' : '📄';
        return `${num} ${icon} \`${item.filename ?? 'file'}\`${dateTag}`;
      })
      .join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle(`#${channelName}`)
    .setDescription(description)
    .setFooter({
      text: items.length > PAGE_SIZE
        ? `Page ${clampedPage + 1}/${totalPages} · ${items.length} item${items.length === 1 ? '' : 's'} · Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`
        : `${items.length} item${items.length === 1 ? '' : 's'} · Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`,
    });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Delete button rows (up to 2 rows of 5)
  for (let rowIdx = 0; rowIdx < Math.ceil(pageItems.length / 5); rowIdx++) {
    const rowItems = pageItems.slice(rowIdx * 5, rowIdx * 5 + 5);
    const buttons: ButtonBuilder[] = rowItems.map((item, btnIdx) =>
      new ButtonBuilder()
        .setCustomId(ids.inspect.delete(item.id, clampedPage))
        .setLabel(`🗑 #${clampedPage * PAGE_SIZE + rowIdx * 5 + btnIdx + 1}`)
        .setStyle(ButtonStyle.Danger),
    );
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));
  }

  // Pagination row (only when there are multiple pages)
  if (items.length > PAGE_SIZE) {
    const prevBtn = new ButtonBuilder()
      .setCustomId(ids.inspect.prev(mailbox.id, clampedPage))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage === 0);

    const pageLabelBtn = new ButtonBuilder()
      .setCustomId(ids.inspect.pageLabel(clampedPage, totalPages))
      .setLabel(`Page ${clampedPage + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextBtn = new ButtonBuilder()
      .setCustomId(ids.inspect.next(mailbox.id, clampedPage))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage === totalPages - 1);

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, pageLabelBtn, nextBtn));
  }

  // Randomize toggle
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ids.inspect.randomize(mailbox.id, clampedPage))
        .setLabel(`🔀 Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`)
        .setStyle(mailbox.randomize ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );

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
    const { embeds, components } = buildInspectContent(mailbox, items, channel.name, 0);
    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
  },
};

export async function handleInspectComponent(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const { action, args } = parseCustomId(interaction.customId);

  if (action === 'del') {
    const itemId = parseInt(args[0] ?? '', 10);
    const page = parseInt(args[1] ?? '0', 10);
    if (isNaN(itemId)) return;

    const item = getItemById(itemId);
    if (!item) {
      await refreshInspectView(interaction, undefined, undefined, page);
      return;
    }

    const mailbox = getMailboxById(item.mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.reply({ content: '❌ You do not own that item.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (item.type !== 'text') {
      try { unlinkSync(item.content); } catch { /* file already gone */ }
    }
    deleteItem(itemId);
    await refreshInspectView(interaction, mailbox.id, mailbox.channelId, page);
    return;
  }

  if (action === 'rand') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    const page = parseInt(args[1] ?? '0', 10);
    if (isNaN(mailboxId)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.reply({ content: '❌ You do not own that mailbox.', flags: MessageFlags.Ephemeral });
      return;
    }

    setMailboxRandomize(mailboxId, !mailbox.randomize);
    await refreshInspectView(interaction, mailboxId, mailbox.channelId, page);
    return;
  }

  if (action === 'prev' || action === 'next') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    const currentPage = parseInt(args[1] ?? '0', 10);
    if (isNaN(mailboxId) || isNaN(currentPage)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.reply({ content: '❌ You do not own that mailbox.', flags: MessageFlags.Ephemeral });
      return;
    }

    const targetPage = action === 'prev' ? currentPage - 1 : currentPage + 1;
    await refreshInspectView(interaction, mailboxId, mailbox.channelId, targetPage);
    return;
  }
}

async function refreshInspectView(
  interaction: ButtonInteraction<'cached'>,
  mailboxId?: number,
  channelId?: string,
  page = 0,
): Promise<void> {
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

  // Clamp page in case the last item on a page was just deleted
  const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const clampedPage = Math.min(page, maxPage);

  const { embeds, components } = buildInspectContent(mailbox, items, channelName, clampedPage);
  await interaction.update({ embeds, components });
}
