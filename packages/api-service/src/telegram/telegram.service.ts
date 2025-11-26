/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot, Command, Update, On, Action, Ctx } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { WalletHandler } from './handlers/wallet.handler';
import { UsersService } from '../users/users.service';
import {
  BuildKeyboardOptions,
  UIBuilderService,
  UIScreenId,
  WalletSlotConfig,
} from './ui-builder.service';

@Update()
@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private walletHandler: WalletHandler,
    private usersService: UsersService,
    private readonly uiBuilder: UIBuilderService,
  ) {}

  async onModuleInit() {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'createwallet', description: 'Create a new wallet' },
      { command: 'checkfunding', description: 'Check wallet funding status' },
      { command: 'deploywallet', description: 'Deploy your wallet' },
      { command: 'login', description: 'Unlock your wallet' },
      { command: 'balance', description: 'Check wallet balance' },
      { command: 'send', description: 'Send tokens' },
      { command: 'history', description: 'View transaction history' },
      { command: 'logout', description: 'Lock your wallet' },
      { command: 'help', description: 'Get help info' },
    ]);
  }

  @Command('start')
  async onStart(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      // Get or create user
      const user = await this.usersService.createOrGetUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name,
      );

      let message = '👋 *Welcome to Zkpal Bot V1.0 *\n\n';

      if (user.isWalletCreated) {
        const wallet = await this.walletHandler.getWalletByUserId(
          user._id.toString(),
        );

        if (!wallet) {
          message += `No wallet found for your account. Please create a new wallet using /createwallet command.\n\n`;
        }

        if (wallet && !wallet.isDeployed) {
          message += '⚠️ *Action Required*\n';
          message += 'Your wallet needs to be deployed before use.\n\n';
          message += '📋 *Next Steps:*\n';
          message += '• Use /balance to verify funding status\n';
          message += '• Use /deploywallet to deploy your wallet\n\n';
        }

        // message += '🔧 *Available Commands:*\n';
        // message += '• /login - Unlock your wallet\n';
        // message += '• /balance - Check wallet balance\n';
        // message += '• /send - Send tokens\n';
        // message += '• /history - View transaction history\n';
        // message += '• /logout - Lock your wallet\n';
        await ctx.reply(message, { parse_mode: 'Markdown' });
        await this.renderDashboard(ctx);
      } else {
        message += '🚀 *Get Started*\n\n';
        message += 'Create your secure wallet to begin:\n';
        message += '• /createwallet - Create a new wallet\n\n';
        message += '🔒 Your wallet will be secured with a password.\n';
        message +=
          '⚠️ *Important:* Keep your password safe and never share it!';
        await ctx.reply(message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  @Command('menu')
  async onMenu(ctx: Context) {
    await this.renderDashboard(ctx);
  }

  @Command('help')
  async onHelp(ctx: Context) {
    const message =
      '📖 Available Commands:\n\n' +
      '/start - Start the bot\n' +
      '/createwallet - Create a new wallet\n' +
      '/checkfunding - Check if wallet is funded\n' +
      '/deploywallet - Deploy your wallet after funding\n' +
      '/login - Unlock your wallet with password\n' +
      '/balance - Check your wallet balance\n' +
      '/send - Send tokens to another address\n' +
      '/history - View your transaction history\n' +
      '/logout - Lock your wallet\n' +
      '/help - Show this help message\n\n' +
      '⚠️ Keep your password safe and never share it!';

    await ctx.reply(message);
  }

  @Action('view:dashboard')
  async handleDashboardAction(@Ctx() ctx: Context) {
    await this.renderDashboard(ctx);
  }

  @Action('refresh:dashboard')
  async handleDashboardRefresh(@Ctx() ctx: Context) {
    await this.renderDashboard(ctx);
  }

  @Action('view:wallets')
  async handleWalletsNavigation(@Ctx() ctx: Context) {
    await this.renderWalletCenter(ctx);
  }

  @Action('wallet:refresh')
  async handleWalletRefresh(@Ctx() ctx: Context) {
    await this.renderWalletCenter(ctx);
  }

  @Action(
    /view:(bags|bridge|tracker|pending|referral|automations|cashback|leaderboard|settings|bots)/,
  )
  async handleComingSoon(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('This section is coming soon 🚧');
  }

  private async renderDashboard(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    const walletAddress = await this.getPrimaryWalletAddress(telegramId);
    const copy = this.buildDashboardCopy(walletAddress);
    await this.renderScreen(ctx, copy, 'dashboard');
  }

  private async renderWalletCenter(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    const { walletSlots, walletAddress } =
      await this.resolveWalletContext(telegramId);
    const copy = this.buildWalletCopy(walletAddress);
    await this.renderScreen(ctx, copy, 'wallets:home', { walletSlots });
  }

  private async renderScreen(
    ctx: Context,
    copy: string,
    screenId: UIScreenId,
    options?: BuildKeyboardOptions,
  ) {
    const replyMarkup = this.uiBuilder.buildScreen(screenId, options);
    const responseOptions = {
      parse_mode: 'Markdown' as const,
      reply_markup: replyMarkup,
    };

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(copy, responseOptions);
      } catch {
        await ctx.reply(copy, responseOptions);
      }
      await ctx.answerCbQuery();
      return;
    }

    await ctx.reply(copy, responseOptions);
  }

  private async resolveWalletContext(telegramId?: string) {
    if (!telegramId) {
      return { walletSlots: undefined, walletAddress: undefined };
    }

    const user = await this.usersService.getUserByTelegramId(telegramId);
    if (!user || !user.isWalletCreated) {
      return { walletSlots: undefined, walletAddress: undefined };
    }

    const wallet = await this.walletHandler.getWalletByUserId(
      user._id.toString(),
    );
    if (!wallet) {
      return { walletSlots: undefined, walletAddress: undefined };
    }

    const slots: WalletSlotConfig[] = [
      {
        id: wallet._id?.toString() ?? 'primary',
        label: 'W1',
        isSelected: true,
      },
    ];

    return { walletSlots: slots, walletAddress: wallet.address };
  }

  private async getPrimaryWalletAddress(telegramId?: string) {
    const context = await this.resolveWalletContext(telegramId);
    return context.walletAddress;
  }

  private buildDashboardCopy(walletAddress?: string): string {
    const walletLine = walletAddress
      ? `Starknet: \`${walletAddress}\` (tab to copy)`
      : 'Starknet: _Connect your wallet via /createwallet_';

    return [walletLine, '', 'Tap a section below to continue.'].join('\n');
  }

  private buildWalletCopy(walletAddress?: string): string {
    const lines = [
      '👛 *Wallet Center*',
      '_Manage imports, transfers, and keys from one place._',
      '',
    ];

    if (walletAddress) {
      lines.push('Active Wallet:', `\`${walletAddress}\``);
    } else {
      lines.push(
        'No wallet connected yet.',
        'Use /createwallet to get started.',
      );
    }

    return lines.join('\n');
  }

  private parseCallbackData(data: string) {
    const [action, query] = data.split('|');
    const payload: Record<string, string> = {};

    if (query) {
      query.split('&').forEach((pair) => {
        const [key, value] = pair.split('=');
        if (key) {
          payload[key] = value ?? '';
        }
      });
    }

    return { action, payload };
  }

  @Command('createwallet')
  async onCreateWallet(ctx: Context) {
    await this.walletHandler.handleCreateWallet(ctx);
  }

  // Active Session Wallet
  @Command('login')
  async onLogin(ctx: Context) {
    await this.walletHandler.handleLogin(ctx);
  }

  @Command('balance')
  async onBalance(ctx: Context) {
    await this.walletHandler.handleBalance(ctx);
  }

  @Command('send')
  async onSend(ctx: Context) {
    const text = (ctx.message as any)?.text || '';
    const args = text.split(' ').slice(1);
    await this.walletHandler.handleSend(ctx, args);
  }

  @Command('history')
  async onHistory(ctx: Context) {
    await this.walletHandler.handleHistory(ctx);
  }

  @Command('logout')
  async onLogout(ctx: Context) {
    await this.walletHandler.handleLogout(ctx);
  }

  @Command('deploywallet')
  async onDeployWallet(ctx: Context) {
    await this.walletHandler.handleDeployWallet(ctx);
  }

  // Handle text messages (for password input)
  @On('text')
  async onText(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const text = (ctx.message as any)?.text || '';

    // Skip if it's a command
    if (text.startsWith('/')) return;

    // Check for pending operations
    if (!this.walletHandler.hasPendingOperation(telegramId)) {
      await ctx.reply(
        'Please use a command. Type /help for available commands.',
      );
      return;
    }

    const pending = this.walletHandler.getPendingOperation(telegramId);

    switch (pending.type) {
      case 'create_wallet':
        await this.walletHandler.handlePasswordInput(ctx, text);
        break;
      case 'unlock_wallet':
        await this.walletHandler.handleUnlockPassword(ctx, text);
        break;
      case 'send_token':
        await this.walletHandler.handleSendConfirmation(ctx, text);
        break;
      case 'deploy_wallet':
        await this.walletHandler.handleDeployPassword(ctx, text);
        break;
      default:
        await ctx.reply('Unknown operation. Please try again.');
    }
  }
}
