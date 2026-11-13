import cron from 'node-cron';
import { unlinkSync } from 'node:fs';
import type { Client } from 'discord.js';
import {
  deleteItem,
  getDatePinnedItems,
  getDueMailboxes,
  getUnscheduledItems,
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
    const now = new Date().toISOString();
    const dueMailboxes = getDueMailboxes(now);
    for (const mailbox of dueMailboxes) {
      // Advance next_post_at BEFORE posting — crash safety
      const newNext = computeNextPostAt(mailbox.postTime, mailbox.frequency, mailbox.nextPostAt);
      setNextPostAt(mailbox.id, newNext);
      try {
        await processMailbox(client, mailbox);
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

async function postItem(client: Client<true>, mailbox: Mailbox, item: Item): Promise<void> {
  const channel = await client.channels.fetch(mailbox.channelId);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    throw new Error(`Channel ${mailbox.channelId} is not a postable text channel`);
  }

  if (item.type === 'text') {
    await channel.send({ content: item.content });
  } else {
    await channel.send({
      files: [{ attachment: item.content, name: item.filename ?? 'file' }],
    });
  }
}

function cleanupItem(item: Item): void {
  if (item.type !== 'text') {
    try { unlinkSync(item.content); } catch { /* file already removed */ }
  }
  deleteItem(item.id);
}
