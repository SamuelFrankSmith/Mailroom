import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createWriteStream, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { addItem, getMailbox, getMailboxAttachmentSizeTotal, getMailboxItemCount } from '../database/db.js';
import { config } from '../config.js';
import { userCanPostInChannel } from '../permissions.js';
import type { Item } from '../types.js';
import type { Command } from './types.js';

const DATE_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/;

function isValidMMdd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [m, d] = s.split('/').map(Number);
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= (daysInMonth[m! - 1] ?? 0);
}

export const mail: Command = {
  data: new SlashCommandBuilder()
    .setName('mail')
    .setDescription('Add an item to your mailbox for a channel')
    .setDMPermission(false)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('The channel whose mailbox to add to')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('content')
        .setDescription('Text content to add')
        .setRequired(false)
    )
    .addAttachmentOption(o =>
      o.setName('attachment')
        .setDescription('Image or file to add')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('date')
        .setDescription('Pin to a specific date MM/dd (e.g. 12/25). Only posts on that date.')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const channel = interaction.options.getChannel('channel', true);
    const content = interaction.options.getString('content');
    const attachment = interaction.options.getAttachment('attachment');
    const dateStr = interaction.options.getString('date');

    if (!content && !attachment) {
      await interaction.reply({
        content: '❌ Provide at least one of `content` (text) or `attachment` (image/file).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (dateStr && !isValidMMdd(dateStr)) {
      await interaction.reply({
        content: '❌ Invalid date format. Use MM/dd (e.g. `12/25`, `01/01`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (attachment && attachment.size > config.maxUploadBytes) {
      await interaction.reply({
        content: `❌ Attachment too large (max ${config.maxUploadBytes / 1024 / 1024} MB).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const mailbox = getMailbox(interaction.user.id, channel.id);
    if (!mailbox) {
      await interaction.reply({
        content: `❌ No mailbox for <#${channel.id}>. Use \`/establish-mailbox\` first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!userCanPostInChannel(interaction, channel)) {
      await interaction.reply({
        content: `❌ You don't have permission to post in <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const itemCount = getMailboxItemCount(mailbox.id);
    if (itemCount >= config.maxQueueItems) {
      await interaction.reply({
        content: `❌ Your mailbox for <#${channel.id}> is full (${config.maxQueueItems} items). Delete some before adding more.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (attachment) {
      const currentBytes = getMailboxAttachmentSizeTotal(mailbox.id);
      if (currentBytes + attachment.size > config.maxCollectionAttachmentBytes) {
        const limitMb = config.maxCollectionAttachmentBytes / 1024 / 1024;
        await interaction.reply({
          content: `❌ Adding this attachment would exceed the ${limitMb} MB total attachment limit for this mailbox. Delete some attachments first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ ephemeral: true });

    const addedItems: Array<{ label: string; date: string | null }> = [];

    if (attachment) {
      const isImage = attachment.contentType?.startsWith('image/') ?? false;
      const type: Item['type'] = isImage ? 'image' : 'file';
      const filename = basename(attachment.name);
      const uploadDir = join(config.uploadsDir, String(mailbox.id));
      mkdirSync(uploadDir, { recursive: true });
      const localPath = join(uploadDir, `${crypto.randomUUID()}_${filename}`);

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30_000);
      try {
        const response = await fetch(attachment.url, { signal: ac.signal });
        if (!response.ok || !response.body) {
          await interaction.editReply({ content: '❌ Failed to download attachment. Please try again.' });
          return;
        }
        await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(localPath));
      } finally {
        clearTimeout(timer);
      }

      addItem({
        mailboxId: mailbox.id,
        type,
        content: localPath,
        filename,
        fileSize: attachment.size,
        scheduledDate: dateStr ?? null,
      });
      addedItems.push({ label: `${isImage ? '🖼️' : '📄'} \`${filename}\``, date: dateStr ?? null });
    }

    if (content) {
      addItem({
        mailboxId: mailbox.id,
        type: 'text',
        content,
        filename: null,
        fileSize: null,
        scheduledDate: dateStr ?? null,
      });
      const preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
      addedItems.push({ label: `"${preview}"`, date: dateStr ?? null });
    }

    const lines = addedItems.map(item => {
      const datePart = item.date ? ` *(pinned: ${item.date})*` : '';
      return `• ${item.label}${datePart}`;
    });

    const nextTimestamp = Math.floor(new Date(mailbox.nextPostAt).getTime() / 1000);
    await interaction.editReply({
      content: `✅ Added to your mailbox for <#${channel.id}>:\n${lines.join('\n')}\n\nNext post from this mailbox: <t:${nextTimestamp}:f>`,
    });
  },
};
