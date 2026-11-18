import cron from 'node-cron';
import { unlinkSync } from 'node:fs';
import type { Client } from 'discord.js';
import {
  deleteItem,
  getDatePinnedItems,
  getDueMailboxes,
  getMailboxById,
  getMailboxesWithDuePinnedItems,
  getUnscheduledItems,
  setLastPinnedPostDate,
  setNextPostAt,
} from '../database/db.js';
import type { Item, Mailbox } from '../types.js';
import { computeNextPostAt, getTodayMMdd } from '../time.js';

let ticking = false;

export function startScheduler(client: Client<true>): void {
  cron.schedule('* * * * *', () => void tick(client));
  console.log('Scheduler started (every minute).');
}

async function tick(client: Client<true>): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const todayMMdd = getTodayMMdd();

    // Phase 1: post pinned items for today across ALL mailboxes, independent of their schedule
    const pinnedMailboxes = getMailboxesWithDuePinnedItems(todayMMdd);
    for (const mailbox of pinnedMailboxes) {
      if (mailbox.lastPinnedPostDate === todayMMdd) continue; // already handled today
      try {
        const pinnedItems = getDatePinnedItems(mailbox.id, todayMMdd);
        for (const item of pinnedItems) {
          await postItem(client, mailbox, item);
          cleanupItem(item);
        }
        setLastPinnedPostDate(mailbox.id, todayMMdd); // stamp AFTER all items succeed
      } catch (err) {
        console.error(`[scheduler] Failed to post pinned items for mailbox ${mailbox.id} (user ${mailbox.userId}):`, err);
      }
    }

    // Phase 2: regular scheduled mailboxes
    const now = new Date().toISOString();
    const dueMailboxes = getDueMailboxes(now);
    for (const mailbox of dueMailboxes) {
      // Advance next_post_at BEFORE posting — crash safety
      const newNext = computeNextPostAt(mailbox.postTime, mailbox.frequency, mailbox.nextPostAt);
      setNextPostAt(mailbox.id, newNext);
      // Re-fetch to pick up lastPinnedPostDate set in Phase 1
      const fresh = getMailboxById(mailbox.id) ?? mailbox;
      try {
        await processMailbox(client, fresh);
      } catch (err) {
        console.error(`[scheduler] Failed to process mailbox ${mailbox.id} (user ${mailbox.userId}, channel ${mailbox.channelId}):`, err);
      }
    }
  } finally {
    ticking = false;
  }
}

async function processMailbox(client: Client<true>, mailbox: Mailbox): Promise<void> {
  const todayMMdd = getTodayMMdd();
  // Pinned items for today were already posted in Phase 1 — skip the regular queue too
  if (mailbox.lastPinnedPostDate === todayMMdd) return;

  const pinnedItems = getDatePinnedItems(mailbox.id, todayMMdd);

  if (pinnedItems.length > 0) {
    // Date-pinned items replace the regular post for this tick
    for (const item of pinnedItems) {
      await postItem(client, mailbox, item);
      cleanupItem(item);
    }
    return;
  }

  const unscheduled = getUnscheduledItems(mailbox.id);
  if (unscheduled.length === 0) return;

  let chosen: Item;
  if (mailbox.randomize) {
    chosen = unscheduled[Math.floor(Math.random() * unscheduled.length)] as Item;
  } else {
    chosen = unscheduled[0] as Item;
  }

  await postItem(client, mailbox, chosen);
  cleanupItem(chosen);
}

export async function postItem(client: Client<true>, mailbox: Mailbox, item: Item): Promise<void> {
  const channel = await client.channels.fetch(mailbox.channelId);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error(`Channel ${mailbox.channelId} is not a postable text channel`);
  }
  if (!('guild' in channel) || channel.guild.id !== mailbox.guildId) {
    throw new Error(`Channel ${mailbox.channelId} does not belong to guild ${mailbox.guildId}`);
  }

  const attribution = `\n*sent by <@${mailbox.userId}>*`;

  if (item.type === 'text') {
    await channel.send({
      content: item.content + attribution,
      allowedMentions: { parse: [] },
    });
  } else {
    await channel.send({
      content: `*sent by <@${mailbox.userId}>*`,
      files: [{ attachment: item.content, name: item.filename ?? 'file' }],
      allowedMentions: { parse: [] },
    });
  }
}

export function cleanupItem(item: Item): void {
  if (item.type !== 'text') {
    try { unlinkSync(item.content); } catch { /* file already removed */ }
  }
  deleteItem(item.id);
}
