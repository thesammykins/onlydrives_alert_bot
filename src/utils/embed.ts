import { EmbedBuilder } from 'discord.js';
import type { AlertEvent } from '../types.js';

const COLORS = {
  price_drop: 0x00ff00,
  price_spike: 0xff0000,
  new_product: 0x0099ff,
  back_in_stock: 0x00ccff,
} as const;

const TITLES = {
  price_drop: 'Price Drop Alert',
  price_spike: 'Price Spike Alert',
  new_product: 'New Product Listed',
  back_in_stock: 'Back in Stock',
} as const;

export function createAlertEmbed(alert: AlertEvent): EmbedBuilder {
  const { product, type, previousPrice, currentPrice, percentChange } = alert;

  const embed = new EmbedBuilder()
    .setColor(COLORS[type])
    .setTitle(TITLES[type])
    .setThumbnail(product.image_url)
    .setTimestamp()
    .setFooter({ text: 'OnlyDrives Monitor' });

  const productInfo = `**${product.name}** (${product.type})\nCondition: ${product.condition}`;
  embed.setDescription(productInfo);

  if (type === 'price_drop' || type === 'price_spike') {
    const direction = type === 'price_drop' ? '' : '+';
    const percentStr = percentChange 
      ? `(${direction}${(percentChange * 100).toFixed(1)}%)`
      : '';
    
    embed.addFields(
      { 
        name: 'Price', 
        value: `~~$${previousPrice?.toFixed(2)}~~ → **$${currentPrice.toFixed(2)}** ${percentStr}`,
        inline: true 
      },
      { 
        name: '$/TB', 
        value: `$${parseFloat(product.current_price_per_tb).toFixed(2)}`,
        inline: true 
      }
    );
  } else {
    embed.addFields(
      { name: 'Price', value: `$${currentPrice.toFixed(2)}`, inline: true },
      { name: '$/TB', value: `$${parseFloat(product.current_price_per_tb).toFixed(2)}`, inline: true }
    );
  }

  embed.addFields(
    { name: 'Capacity', value: `${product.capacity_tb} TB`, inline: true },
    { name: 'Source', value: product.source, inline: true }
  );

  embed.setURL(product.url);

  return embed;
}
