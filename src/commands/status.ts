import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';

export function createStatusCommand(db: Database): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('status')
      .setDescription('Show bot status and monitoring statistics'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const states = db.getAllProductStates();
      const availableCount = states.filter(s => s.last_available).length;
      
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('OnlyDrives Monitor Status')
        .setTimestamp()
        .addFields(
          { name: 'Products Tracked', value: String(states.length), inline: true },
          { name: 'Available', value: String(availableCount), inline: true },
          { name: 'Unavailable', value: String(states.length - availableCount), inline: true }
        );

      if (states.length > 0) {
        const lastCheck = states.reduce((latest, s) => 
          s.last_checked_at > latest ? s.last_checked_at : latest, 
          states[0]!.last_checked_at
        );
        embed.addFields({ 
          name: 'Last Check', 
          value: new Date(lastCheck).toLocaleString(), 
          inline: false 
        });
      }

      await interaction.reply({ embeds: [embed] });
    },
  };
}
