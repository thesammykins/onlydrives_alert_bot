import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../bot.js';
import { OnlyDrivesApi } from '../services/api.js';

export function createHistoryCommand(): Command {
  const api = new OnlyDrivesApi();

  return {
    data: new SlashCommandBuilder()
      .setName('history')
      .setDescription('Show price history for a product')
      .addStringOption(option =>
        option
          .setName('sku')
          .setDescription('Product SKU (e.g., "amazon-B0CHGT3XXW")')
          .setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      await interaction.deferReply();

      try {
        const skuInput = interaction.options.getString('sku', true);
        
        const [source, ...skuParts] = skuInput.split('-');
        const sku = skuParts.join('-');

        if (!source || !sku) {
          await interaction.editReply('Invalid SKU format. Use "source-sku" (e.g., "amazon-B0CHGT3XXW")');
          return;
        }

        const history = await api.fetchPriceHistory(source, sku);

        if (history.length === 0) {
          await interaction.editReply(`No price history found for ${skuInput}`);
          return;
        }

        const recentHistory = history.slice(-10);

        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle(`Price History: ${skuInput}`)
          .setTimestamp()
          .setFooter({ text: 'OnlyDrives Monitor' });

        const historyLines = recentHistory.map(entry => {
          const date = new Date(entry.recorded_at).toLocaleDateString();
          const total = parseFloat(entry.price_total).toFixed(2);
          const perTb = parseFloat(entry.price_per_tb).toFixed(2);
          return `${date}: $${total} ($${perTb}/TB)`;
        });

        embed.setDescription('```\n' + historyLines.join('\n') + '\n```');
        embed.addFields({
          name: 'Data Points',
          value: `Showing ${recentHistory.length} of ${history.length} records`,
          inline: false
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[History] Error fetching history:', error);
        await interaction.editReply('Failed to fetch price history. Please try again later.');
      }
    },
  };
}
