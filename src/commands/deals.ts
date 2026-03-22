import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';
import { OnlyDrivesApi } from '../services/api.js';

export function createDealsCommand(db: Database): Command {
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
      )
      .addNumberOption(option =>
        option
          .setName('min_price')
          .setDescription('Minimum total price ($)')
          .setMinValue(0)
      )
      .addNumberOption(option =>
        option
          .setName('max_price')
          .setDescription('Maximum total price ($)')
          .setMinValue(0)
      )
      .addNumberOption(option =>
        option
          .setName('min_per_tb')
          .setDescription('Minimum $/TB')
          .setMinValue(0)
      )
      .addNumberOption(option =>
        option
          .setName('max_per_tb')
          .setDescription('Maximum $/TB')
          .setMinValue(0)
      )
      .addStringOption(option =>
        option
          .setName('condition')
          .setDescription('Filter by condition')
      )
      .addStringOption(option =>
        option
          .setName('source')
          .setDescription('Filter by source name')
      ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      await interaction.deferReply();

      try {
        const count = interaction.options.getInteger('count') ?? 5;
        const typeFilter = interaction.options.getString('type') as 'HDD' | 'SSD' | null;
        const minPrice = interaction.options.getNumber('min_price');
        const maxPrice = interaction.options.getNumber('max_price');
        const minPerTb = interaction.options.getNumber('min_per_tb');
        const maxPerTb = interaction.options.getNumber('max_per_tb');
        const conditionFilter = interaction.options.getString('condition')?.toLowerCase() ?? null;
        const sourceFilter = interaction.options.getString('source')?.toLowerCase() ?? null;

        let products;
        let usingCache = false;

        try {
          products = await api.fetchProducts();
        } catch {
          products = db.getCachedProducts();
          usingCache = true;
        }

        let available = products.filter(p => p.available);
        if (typeFilter) {
          available = available.filter(p => p.type === typeFilter);
        }
        if (conditionFilter) {
          available = available.filter(p => p.condition.toLowerCase().includes(conditionFilter));
        }
        if (sourceFilter) {
          available = available.filter(p => p.source.toLowerCase().includes(sourceFilter));
        }
        if (minPrice !== null) {
          available = available.filter(p => parseFloat(p.current_price_total) >= minPrice);
        }
        if (maxPrice !== null) {
          available = available.filter(p => parseFloat(p.current_price_total) <= maxPrice);
        }
        if (minPerTb !== null) {
          available = available.filter(p => parseFloat(p.current_price_per_tb) >= minPerTb);
        }
        if (maxPerTb !== null) {
          available = available.filter(p => parseFloat(p.current_price_per_tb) <= maxPerTb);
        }

        const sorted = available.sort((a, b) =>
          parseFloat(a.current_price_per_tb) - parseFloat(b.current_price_per_tb)
        );

        const topDeals = sorted.slice(0, count);

        if (topDeals.length === 0) {
          await interaction.editReply('No deals found matching your criteria.');
          return;
        }

        const footerText = usingCache
          ? 'OnlyDrives Monitor • ⚠️ Using cached data'
          : 'OnlyDrives Monitor';

        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle(`Top ${topDeals.length} Best $/TB Deals${typeFilter ? ` (${typeFilter})` : ''}`)
          .setTimestamp()
          .setFooter({ text: footerText });

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
