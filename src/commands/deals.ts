import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../bot.js';
import { OnlyDrivesApi } from '../services/api.js';

export function createDealsCommand(): Command {
  const api = new OnlyDrivesApi();

  return {
    data: new SlashCommandBuilder()
      .setName('deals')
      .setDescription('Show the best $/TB deals currently available')
      .addIntegerOption(option =>
        option
          .setName('count')
          .setDescription('Number of deals to show (default: 5)')
          .setMinValue(1)
          .setMaxValue(25)
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Filter by drive type')
          .addChoices(
            { name: 'HDD', value: 'HDD' },
            { name: 'SSD', value: 'SSD' }
          )
      ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      await interaction.deferReply();

      try {
        const count = interaction.options.getInteger('count') ?? 5;
        const typeFilter = interaction.options.getString('type') as 'HDD' | 'SSD' | null;

        const products = await api.fetchProducts();
        
        let available = products.filter(p => p.available);
        if (typeFilter) {
          available = available.filter(p => p.type === typeFilter);
        }

        const sorted = available.sort((a, b) => 
          parseFloat(a.current_price_per_tb) - parseFloat(b.current_price_per_tb)
        );

        const topDeals = sorted.slice(0, count);

        if (topDeals.length === 0) {
          await interaction.editReply('No deals found matching your criteria.');
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle(`Top ${topDeals.length} Best $/TB Deals${typeFilter ? ` (${typeFilter})` : ''}`)
          .setTimestamp()
          .setFooter({ text: 'OnlyDrives Monitor' });

        const description = topDeals.map((p, i) => {
          const pricePerTb = parseFloat(p.current_price_per_tb).toFixed(2);
          const total = parseFloat(p.current_price_total).toFixed(2);
          return `**${i + 1}.** [${p.name}](${p.url})\n` +
                 `   ${p.capacity_tb}TB ${p.type} • **$${pricePerTb}/TB** • $${total} total`;
        }).join('\n\n');

        embed.setDescription(description);

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('[Deals] Error fetching deals:', error);
        await interaction.editReply('Failed to fetch deals. Please try again later.');
      }
    },
  };
}
