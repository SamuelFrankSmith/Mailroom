import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Mailbox, Item } from '../types.js';

interface MailboxRow {
  id: number;
  user_id: string;
  channel_id: string;
  guild_id: string;
  frequency: string;
  post_time: string;
  randomize: number;
  next_post_at: string;
}

interface ItemRow {
  id: number;
  mailbox_id: number;
  type: string;
  content: string;
  filename: string | null;
  scheduled_date: string | null;
  created_at: string;
}

let db: DatabaseSync;

function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    userId: row.user_id,
    channelId: row.channel_id,
    guildId: row.guild_id,
    frequency: row.frequency,
    postTime: row.post_time,
    randomize: row.randomize === 1,
    nextPostAt: row.next_post_at,
  };
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    type: row.type as Item['type'],
    content: row.content,
    filename: row.filename,
    scheduledDate: row.scheduled_date,
    createdAt: row.created_at,
  };
}

export function openDatabase(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailboxes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT    NOT NULL,
      channel_id   TEXT    NOT NULL,
      guild_id     TEXT    NOT NULL,
      frequency    TEXT    NOT NULL,
      post_time    TEXT    NOT NULL,
      randomize    INTEGER NOT NULL DEFAULT 0,
      next_post_at TEXT    NOT NULL,
      UNIQUE(user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_id     INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      type           TEXT    NOT NULL CHECK(type IN ('text','image','file')),
      content        TEXT    NOT NULL,
      filename       TEXT,
      scheduled_date TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_mailbox ON items(mailbox_id);
    CREATE INDEX IF NOT EXISTS idx_mailboxes_nextpost ON mailboxes(next_post_at);
  `);
}

export function upsertMailbox(fields: Omit<Mailbox, 'id'>): Mailbox {
  db.prepare(`
    INSERT INTO mailboxes (user_id, channel_id, guild_id, frequency, post_time, randomize, next_post_at)
    VALUES (:userId, :channelId, :guildId, :frequency, :postTime, :randomize, :nextPostAt)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      guild_id     = excluded.guild_id,
      frequency    = excluded.frequency,
      post_time    = excluded.post_time,
      next_post_at = excluded.next_post_at
  `).run({
    userId: fields.userId,
    channelId: fields.channelId,
    guildId: fields.guildId,
    frequency: fields.frequency,
    postTime: fields.postTime,
    randomize: fields.randomize ? 1 : 0,
    nextPostAt: fields.nextPostAt,
  });

  const row = db.prepare('SELECT * FROM mailboxes WHERE user_id = ? AND channel_id = ?')
    .get(fields.userId, fields.channelId) as unknown as MailboxRow;
  return toMailbox(row);
}

export function getMailbox(userId: string, channelId: string): Mailbox | undefined {
  const row = db.prepare('SELECT * FROM mailboxes WHERE user_id = ? AND channel_id = ?')
    .get(userId, channelId) as unknown as MailboxRow | undefined;
  return row ? toMailbox(row) : undefined;
}

export function getMailboxById(id: number): Mailbox | undefined {
  const row = db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(id) as unknown as MailboxRow | undefined;
  return row ? toMailbox(row) : undefined;
}

export function getDueMailboxes(now: string): Mailbox[] {
  const rows = db.prepare('SELECT * FROM mailboxes WHERE next_post_at <= ?').all(now) as unknown as MailboxRow[];
  return rows.map(toMailbox);
}

export function setMailboxRandomize(id: number, randomize: boolean): void {
  db.prepare('UPDATE mailboxes SET randomize = ? WHERE id = ?').run(randomize ? 1 : 0, id);
}

export function setNextPostAt(id: number, nextPostAt: string): void {
  db.prepare('UPDATE mailboxes SET next_post_at = ? WHERE id = ?').run(nextPostAt, id);
}

export function addItem(fields: Omit<Item, 'id' | 'createdAt'>): Item {
  const result = db.prepare(`
    INSERT INTO items (mailbox_id, type, content, filename, scheduled_date)
    VALUES (:mailboxId, :type, :content, :filename, :scheduledDate)
  `).run({
    mailboxId: fields.mailboxId,
    type: fields.type,
    content: fields.content,
    filename: fields.filename ?? null,
    scheduledDate: fields.scheduledDate ?? null,
  });

  const row = db.prepare('SELECT * FROM items WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as ItemRow;
  return toItem(row);
}

export function getItemById(id: number): Item | undefined {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as unknown as ItemRow | undefined;
  return row ? toItem(row) : undefined;
}

export function getItemsForMailbox(mailboxId: number): Item[] {
  const rows = db.prepare('SELECT * FROM items WHERE mailbox_id = ? ORDER BY created_at ASC')
    .all(mailboxId) as unknown as ItemRow[];
  return rows.map(toItem);
}

export function getDatePinnedItems(mailboxId: number, date: string): Item[] {
  const rows = db.prepare(
    'SELECT * FROM items WHERE mailbox_id = ? AND scheduled_date = ? ORDER BY created_at ASC'
  ).all(mailboxId, date) as unknown as ItemRow[];
  return rows.map(toItem);
}

export function getUnscheduledItems(mailboxId: number): Item[] {
  const rows = db.prepare(
    'SELECT * FROM items WHERE mailbox_id = ? AND scheduled_date IS NULL ORDER BY created_at ASC'
  ).all(mailboxId) as unknown as ItemRow[];
  return rows.map(toItem);
}

export function deleteItem(id: number): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
}
