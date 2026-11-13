import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { commands } from './commands/index.js';
import { config } from './config.js';

export async function deployCommands(joinedGuildIds: string[] = []): Promise<void> {
  const rest = new REST().setToken(config.token);
  const body = commands.map(c => c.data.toJSON());

  if (config.guildId) {
    // Guild-scoped (dev): instant propagation
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    // Clear global commands from any previous global-deploy run
    await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
    console.log(`Registered ${body.length} commands to guild ${config.guildId}.`);
  } else {
    // Global deploy
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    // Clear guild-scoped commands from any previous dev run
    for (const guildId of joinedGuildIds) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: [] });
    }
    console.log(`Registered ${body.length} commands globally.`);
  }
}

// Allow running as a standalone script: `node dist/deploy-commands.js`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  deployCommands().catch(err => { console.error(err); process.exit(1); });
}
