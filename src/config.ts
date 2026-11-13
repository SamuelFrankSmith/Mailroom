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
} as const;
