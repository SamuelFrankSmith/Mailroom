import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { unlinkSync } from 'node:fs';
import {
  deleteItem,
  getItemById,
  getItemsForMailbox,
  getMailbox,
  getMailboxById,
  setMailboxRandomize,
  upsertMailbox,
} from '../database/db.js';
import type { Item, Mailbox } from '../types.js';
import { computeInitialNextPostAt, validateFrequency } from '../time.js';
import { ids, parseCustomId } from '../ui/customIds.js';
import type { Command } from './types.js';

const PAGE_SIZE = 10;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

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

  const nextTimestamp = Math.floor(new Date(mailbox.nextPostAt).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`#${channelName}`)
    .setDescription(description)
    .addFields(
      { name: 'Posts every', value: `\`${mailbox.frequency}\` at \`${mailbox.postTime} UTC\``, inline: true },
      { name: 'Next post',   value: `<t:${nextTimestamp}:f>`,                                  inline: true },
    )
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

  // Control row: Randomize + Edit frequency
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ids.inspect.randomize(mailbox.id, clampedPage))
        .setLabel(`🔀 Randomize: ${mailbox.randomize ? 'ON' : 'OFF'}`)
        .setStyle(mailbox.randomize ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ids.inspect.editFreq(mailbox.id, clampedPage))
        .setLabel('✏️ Edit frequency')
        .setStyle(ButtonStyle.Primary),
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

    // Build a preview of what's being deleted
    let preview: string;
    if (item.type === 'text') {
      preview = item.content.length > 150 ? item.content.slice(0, 150) + '…' : item.content;
    } else {
      const icon = item.type === 'image' ? '🖼️' : '📄';
      preview = `${icon} \`${item.filename ?? 'file'}\``;
    }
    if (item.scheduledDate) preview += ` *(pinned: ${item.scheduledDate})*`;

    const confirmEmbed = new EmbedBuilder()
      .setTitle('Delete this item?')
      .setDescription(preview)
      .setFooter({ text: 'This cannot be undone.' });

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ids.inspect.delYes(itemId, page))
        .setLabel('Yes, delete it')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(ids.inspect.delNo(itemId, page))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
    return;
  }

  if (action === 'del-yes') {
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
      await interaction.update({ content: '❌ You do not own that item.', embeds: [], components: [] });
      return;
    }

    if (item.type !== 'text') {
      try { unlinkSync(item.content); } catch { /* file already gone */ }
    }
    deleteItem(itemId);
    await refreshInspectView(interaction, mailbox.id, mailbox.channelId, page);
    return;
  }

  if (action === 'del-no') {
    const itemId = parseInt(args[0] ?? '', 10);
    const page = parseInt(args[1] ?? '0', 10);
    if (isNaN(itemId)) return;

    const item = getItemById(itemId);
    const mailboxId = item?.mailboxId;
    const mailbox = mailboxId !== undefined ? getMailboxById(mailboxId) : undefined;
    await refreshInspectView(interaction, mailbox?.id, mailbox?.channelId, page);
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

  if (action === 'edit-freq') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    const page = parseInt(args[1] ?? '0', 10);
    if (isNaN(mailboxId)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.reply({ content: '❌ You do not own that mailbox.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(ids.inspect.editFreqModal(mailboxId, page))
        .setTitle('Edit Schedule')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('time')
              .setLabel('Post time (HH:mm, 24h, UTC)')
              .setStyle(TextInputStyle.Short)
              .setValue(mailbox.postTime)
              .setPlaceholder('e.g. 09:00')
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('frequency')
              .setLabel('Frequency (e.g. 3d, 2w, 4h, 1y)')
              .setStyle(TextInputStyle.Short)
              .setValue(mailbox.frequency)
              .setPlaceholder('e.g. 3d')
              .setRequired(true),
          ),
        ),
    );
    return;
  }

  if (action === 'confirm-freq') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    const newTime = `${args[2] ?? ''}:${args[3] ?? ''}`;
    const newFreq = args[4] ?? '';
    if (isNaN(mailboxId)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.update({ content: '❌ You do not own that mailbox.', embeds: [], components: [] });
      return;
    }

    const timeMatch = TIME_RE.exec(newTime);
    const h = parseInt(timeMatch?.[1] ?? '', 10);
    const m = parseInt(timeMatch?.[2] ?? '', 10);
    if (!timeMatch || h > 23 || m > 59 || validateFrequency(newFreq) !== null) {
      await interaction.update({ content: '❌ Invalid schedule data.', embeds: [], components: [] });
      return;
    }

    const nextPostAt = computeInitialNextPostAt(newTime, newFreq, new Date().toISOString());
    upsertMailbox({
      userId: mailbox.userId,
      channelId: mailbox.channelId,
      guildId: mailbox.guildId,
      frequency: newFreq,
      postTime: newTime,
      randomize: mailbox.randomize,
      nextPostAt,
    });

    const nextTimestamp = Math.floor(new Date(nextPostAt).getTime() / 1000);
    await interaction.update({
      content: `✅ Schedule updated for <#${mailbox.channelId}>.\nFrequency: \`${newFreq}\` at \`${newTime} UTC\` · Next post: <t:${nextTimestamp}:f>`,
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'cancel-freq') {
    await interaction.update({ content: 'Update cancelled.', embeds: [], components: [] });
    return;
  }
}

export async function handleInspectModal(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const { action, args } = parseCustomId(interaction.customId);

  if (action === 'edit-freq-modal') {
    const mailboxId = parseInt(args[0] ?? '', 10);
    const page = parseInt(args[1] ?? '0', 10);
    if (isNaN(mailboxId)) return;

    const mailbox = getMailboxById(mailboxId);
    if (!mailbox || mailbox.userId !== interaction.user.id || mailbox.guildId !== interaction.guildId) {
      await interaction.reply({ content: '❌ You do not own that mailbox.', flags: MessageFlags.Ephemeral });
      return;
    }

    const rawTime = interaction.fields.getTextInputValue('time').trim();
    const rawFreq = interaction.fields.getTextInputValue('frequency').trim().toLowerCase();

    const timeMatch = TIME_RE.exec(rawTime);
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

    const freqError = validateFrequency(rawFreq);
    if (freqError) {
      await interaction.reply({
        content: '❌ Invalid frequency. Use a number followed by `h`, `d`, `w`, or `y`. Examples: `1d`, `3d`, `2w`, `4h`, `1y`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const previewNextPostAt = computeInitialNextPostAt(normalizedTime, rawFreq, new Date().toISOString());
    const nextTimestamp = Math.floor(new Date(previewNextPostAt).getTime() / 1000);
    const [hh, mm] = normalizedTime.split(':') as [string, string];

    const confirmEmbed = new EmbedBuilder()
      .setTitle('Confirm schedule update')
      .addFields(
        { name: 'Post time', value: `\`${mailbox.postTime} UTC\` → \`${normalizedTime} UTC\``, inline: true },
        { name: 'Frequency', value: `\`${mailbox.frequency}\` → \`${rawFreq}\``,               inline: true },
        { name: 'Next post', value: `<t:${nextTimestamp}:f>`,                                   inline: false },
      );

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ids.inspect.confirmFreq(mailboxId, page, hh, mm, rawFreq))
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(ids.inspect.cancelFreq(mailboxId, page))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], flags: MessageFlags.Ephemeral });
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
