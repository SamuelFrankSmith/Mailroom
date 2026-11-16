import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env['GUILD_ID']?.trim() || undefined,
  dbPath: process.env['DB_PATH']?.trim() || './data/bot.db',
  uploadsDir: process.env['UPLOADS_DIR']?.trim() || './data/uploads',
  enforceChannelPermissions: process.env['ENFORCE_CHANNEL_PERMISSIONS']?.trim().toLowerCase() === 'true',
  maxUploadBytes: parseInt(process.env['MAX_UPLOAD_MB'] ?? '100', 10) * 1024 * 1024,
  maxQueueItems: parseInt(process.env['MAX_QUEUE_ITEMS_PER_COLLECTION'] ?? '400', 10),
  maxCollectionAttachmentBytes: parseInt(process.env['MAX_COLLECTION_ATTACHMENT_MB'] ?? '100', 10) * 1024 * 1024,
} as const;
