import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { Database } from './services/database.js';
import { loadCommands } from './commands/index.js';

async function deployCommands(): Promise<void> {
  const config = loadConfig();
  const db = new Database(':memory:');
  const commands = loadCommands(db);

  const commandData = commands.map(c => c.data.toJSON());

  const rest = new REST().setToken(config.discord.token);

  try {
    console.log(`Deploying ${commandData.length} commands...`);

    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commandData }
      );
      console.log(`Commands deployed to guild ${config.discord.guildId}`);
    } else {
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandData }
      );
      console.log('Commands deployed globally (may take up to 1 hour to propagate)');
    }
  } catch (error) {
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

deployCommands();
