import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { openDatabase } from './database/db.js';
import { commandMap } from './commands/index.js';
import { handleInspectComponent, handleInspectModal } from './commands/inspect.js';
import { deployCommands } from './deploy-commands.js';
import { startScheduler } from './scheduler/index.js';
import { parseCustomId } from './ui/customIds.js';
import { config } from './config.js';

openDatabase(config.dbPath);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async ready => {
  console.log(`Logged in as ${ready.user.tag}`);
  try {
    await deployCommands([...ready.guilds.cache.keys()]);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
  startScheduler(ready);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inCachedGuild()) return;

  try {
    if (interaction.isChatInputCommand()) {
      await commandMap.get(interaction.commandName)?.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const { namespace } = parseCustomId(interaction.customId);
      if (namespace === 'insp') {
        await handleInspectComponent(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const { namespace } = parseCustomId(interaction.customId);
      if (namespace === 'insp') {
        await handleInspectModal(interaction);
      }
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.isRepliable()) return;
    const payload = { content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral } as const;
    await (interaction.replied || interaction.deferred
      ? interaction.followUp(payload)
      : interaction.reply(payload)
    ).catch(() => undefined);
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down.`);
    void client.destroy().finally(() => process.exit(0));
  });
}

await client.login(config.token);
