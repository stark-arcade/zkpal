import { Injectable } from '@nestjs/common';
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';

export type UIScreenId = 'dashboard' | 'wallets:home';

type ButtonConfig =
  | {
      text: string;
      action: string;
      payload?: Record<string, string>;
      type?: 'callback';
    }
  | {
      text: string;
      url: string;
      type: 'url';
    };

type DynamicRowConfig = {
  type: 'dynamic';
  source: 'walletSlots';
  chunk?: number;
};

type ScreenStructure = Array<ButtonConfig[] | DynamicRowConfig>;

export interface WalletSlotConfig {
  id: string;
  label: string;
  isSelected?: boolean;
}

export interface BuildKeyboardOptions {
  walletSlots?: WalletSlotConfig[];
}

@Injectable()
export class UIBuilderService {
  private readonly screens: Record<UIScreenId, ScreenStructure> = {
    dashboard: [
      [{ text: '👛 Wallets', action: 'view:wallets' }],

      [
        { text: '🔄 Logout', action: 'logout' },
        { text: '🔄 Refresh', action: 'refresh:dashboard' },
      ],
    ],
    'wallets:home': [
      [
        { text: '💰 Balance', action: 'wallet:balance' },
        { text: '🪙 Tx History', action: 'wallet:history' },
      ],
      [
        { text: '💰 Transfer Public', action: 'wallet:transfer_public' },
        { text: '🪙 Transfer Private', action: 'wallet:transfer_private' },
      ],
      [
        { text: '🌉 Shield Token', action: 'wallet:shield' },
        { text: '🔭 Unshield Token', action: 'wallet:unshield' },
      ],
      [{ text: '🔄 Refresh', action: 'wallet:refresh' }],
      [{ text: '🔙 Back to Home', action: 'view:dashboard' }],
    ],
  };

  buildScreen(
    screenId: UIScreenId,
    options: BuildKeyboardOptions = {},
  ): { inline_keyboard: InlineKeyboardButton[][] } {
    const structure = this.screens[screenId];
    if (!structure) {
      throw new Error(`Unknown screen layout: ${screenId}`);
    }

    const inline_keyboard: InlineKeyboardButton[][] = [];

    structure.forEach((row) => {
      if (Array.isArray(row)) {
        inline_keyboard.push(row.map((button) => this.toInlineButton(button)));
        return;
      }

      if (row.type === 'dynamic' && row.source === 'walletSlots') {
        const slots = this.buildWalletSlotRows(
          options.walletSlots,
          row.chunk ?? 5,
        );
        inline_keyboard.push(...slots);
      }
    });

    return { inline_keyboard };
  }

  private toInlineButton(button: ButtonConfig): InlineKeyboardButton {
    if (button.type === 'url') {
      return {
        text: button.text,
        url: button.url,
      };
    }

    return {
      text: button.text,
      callback_data: this.buildCallbackData(button.action, button.payload),
    };
  }

  private buildWalletSlotRows(
    walletSlots: WalletSlotConfig[] = [],
    chunkSize: number,
  ): InlineKeyboardButton[][] {
    const slots =
      walletSlots.length > 0 ? walletSlots : this.buildDefaultWalletSlots();

    const rows: InlineKeyboardButton[][] = [];

    for (let i = 0; i < slots.length; i += chunkSize) {
      const chunk = slots.slice(i, i + chunkSize);
      rows.push(
        chunk.map((slot) => ({
          text: slot.isSelected ? `${slot.label} ✅` : slot.label,
          callback_data: this.buildCallbackData('wallet:switch', {
            id: slot.id,
          }),
        })),
      );
    }

    return rows;
  }

  private buildDefaultWalletSlots(): WalletSlotConfig[] {
    return Array.from({ length: 5 }, (_, index) => ({
      id: `w${index + 1}`,
      label: `W${index + 1}`,
      isSelected: index === 0,
    }));
  }

  private buildCallbackData(
    action: string,
    payload?: Record<string, string>,
  ): string {
    if (!payload || Object.keys(payload).length === 0) {
      return action;
    }

    const serialized = Object.entries(payload)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    const data = `${action}|${serialized}`;
    return data.slice(0, 64);
  }
}
