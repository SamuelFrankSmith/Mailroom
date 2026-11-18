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
import {
  getDatePinnedItems,
  getItemById,
  getMailbox,
  getMailboxById,
  getUnscheduledItems,
  setLastPinnedPostDate,
  setNextPostAt,
} from '../database/db.js';
import type { Item, Mailbox } from '../types.js';
import { cleanupItem, postItem } from '../scheduler/index.js';
import { computeInitialNextPostAt, getTodayMMdd } from '../time.js';
import { ids, parseCustomId } from '../ui/customIds.js';
import type { Command } from './types.js';

function resolvePublishTarget(mailbox: Mailbox): Item[] | null {
  const todayMMdd = getTodayMMdd();
  if (mailbox.lastPinnedPostDate !== todayMMdd) {
    const pinned = getDatePinnedItems(mailbox.id, todayMMdd);
    if (pinned.length > 0) return pinned;
  }
  const unscheduled = getUnscheduledItems(mailbox.id);
  if (unscheduled.length === 0) return null;
  const chosen = mailbox.randomize
    ? unscheduled[Math.floor(Math.random() * unscheduled.length)]!
    : unscheduled[0]!;
  return [chosen];
}

function itemPreviewLine(item: Item): string {
  if (item.type === 'text') {
    const text = item.content.length > 150 ? item.content.slice(0, 150) + '…' : item.content;
    const datePart = item.scheduledDate ? ` *(pinned: ${item.scheduledDate})*` : '';
    return text + datePart;
  }
  const icon = item.type === 'image' ? '🖼️' : '📄';
  const textPart = item.textContent
    ? ` + "${item.textContent.length > 80 ? item.textContent.slice(0, 80) + '…' : item.textContent}"`
    : '';
  const datePart = item.scheduledDate ? ` *(pinned: ${item.scheduledDate})*` : '';
  return `${icon} \`${item.filename ?? 'file'}\`${textPart}${datePart}`;
}

export const publish: Command = {
  data: new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Post the next item from your mailbox immediately and reset the schedule')
    .setDMPermission(false)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('The channel whose mailbox to publish from')
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

    const items = resolvePublishTarget(mailbox);

    if (!items) {
      await interaction.reply({
        content: `❌ Nothing to post — your mailbox for <#${channel.id}> is empty.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isPinned = items[0]!.scheduledDate !== null;
    const description = items.map((item, i) =>
      items.length > 1 ? `**${i + 1}.** ${itemPreviewLine(item)}` : itemPreviewLine(item)
    ).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`Publish to #${channel.name}?`)
      .setDescription(description)
      .setFooter({ text: 'This will post immediately and reset your schedule.' });

    const confirmButton = isPinned
      ? new ButtonBuilder()
          .setCustomId(ids.publish.confirmPinned(mailbox.id))
          .setLabel('Publish now')
          .setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId(ids.publish.confirmItem(mailbox.id, items[0]!.id))
          .setLabel('Publish now')
          .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
      .setCustomId(ids.publish.cancel(mailbox.id))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  },
};

export async function handlePublishComponent(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const { action, args } = parseCustomId(interaction.customId);
  const mailboxId = parseInt(args[0] ?? '', 10);
  if (isNaN(mailboxId)) return;

  if (action === 'cancel') {
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
    return;
  }

  const mailbox = getMailboxById(mailboxId);
  if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
    await interaction.update({ content: '❌ You do not own that mailbox.', embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();

  if (action === 'confirm-pinned') {
    const todayMMdd = getTodayMMdd();
    const pinned = getDatePinnedItems(mailbox.id, todayMMdd);
    if (pinned.length === 0) {
      await interaction.editReply({ content: '❌ No pinned items for today — they may have already posted.', embeds: [], components: [] });
      return;
    }
    for (const item of pinned) {
      await postItem(interaction.client, mailbox, item);
      cleanupItem(item);
    }
    setLastPinnedPostDate(mailbox.id, todayMMdd);
  } else if (action === 'confirm-item') {
    const itemId = parseInt(args[1] ?? '', 10);
    if (isNaN(itemId)) {
      await interaction.editReply({ content: '❌ Invalid item.', embeds: [], components: [] });
      return;
    }
    const item = getItemById(itemId);
    if (!item || item.mailboxId !== mailbox.id) {
      await interaction.editReply({ content: '❌ That item no longer exists.', embeds: [], components: [] });
      return;
    }
    await postItem(interaction.client, mailbox, item);
    cleanupItem(item);
  } else {
    return;
  }

  const nextPostAt = computeInitialNextPostAt(mailbox.postTime, mailbox.frequency, new Date().toISOString());
  setNextPostAt(mailbox.id, nextPostAt);
  const nextTimestamp = Math.floor(new Date(nextPostAt).getTime() / 1000);

  await interaction.editReply({
    content: `✅ Posted to <#${mailbox.channelId}>. Next post: <t:${nextTimestamp}:f>`,
    embeds: [],
    components: [],
  });
}
