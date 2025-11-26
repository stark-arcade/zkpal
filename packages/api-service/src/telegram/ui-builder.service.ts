import { Injectable } from '@nestjs/common';

@Injectable()
export class UIBuilderService {
  buildDashboardKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '🔴 Your Bags', callback_data: 'view:bags' },
          { text: '👛 Wallets', callback_data: 'view:wallets' },
        ],
        [
          { text: '🌉 Bridge', callback_data: 'view:bridge' },
          { text: '🔭 Wallet Tracker', callback_data: 'view:tracker' },
        ],
        [
          { text: '⏰ Pending Orders', callback_data: 'view:pending' },
          { text: '👥 Referral', callback_data: 'view:referral' },
        ],
        [
          { text: '✨ Automations', callback_data: 'view:automations' },
          { text: '💰 Cashback ✨ NEW', callback_data: 'view:cashback' },
        ],
        [
          { text: '🏆 Leaderboard', callback_data: 'view:leaderboard' },
          { text: '⚙️ Settings', callback_data: 'view:settings' },
        ],
        [
          { text: '🤖 Bots & Channels', callback_data: 'view:bots' },
          { text: '📁 Docs', url: 'https://docs.example.com' },
        ],
        [{ text: '🔄 Refresh', callback_data: 'refresh:dashboard' }],
      ],
    };
  }

  buildHelpKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '🚀 Get Started', callback_data: 'help:get_started' },
          { text: '🆘 Support', callback_data: 'help:support' },
        ],
        [
          { text: '🔐 Security Tips', callback_data: 'help:security' },
          { text: '💬 Feedback', callback_data: 'help:feedback' },
        ],
        [
          { text: '📁 Docs', url: 'https://docs.zkpal.com' },
          { text: '🤖 Channels', callback_data: 'help:bots' },
        ],
        [{ text: '⬅️ Back', callback_data: 'view:dashboard' }],
      ],
    };
  }

  buildBagsKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📋 Copy Address', callback_data: 'bags:copy_address' },
          { text: '🔄 Refresh', callback_data: 'refresh:bags' },
        ],
        [{ text: '⬅️ Back to Home', callback_data: 'view:dashboard' }],
      ],
    };
  }
}
