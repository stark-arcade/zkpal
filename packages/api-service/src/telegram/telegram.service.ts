/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot, Command, Update, On, Action, Ctx } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';
import { WalletHandler } from './handlers/wallet.handler';
import { UsersService } from '../users/users.service';
import {
  BuildKeyboardOptions,
  UIBuilderService,
  UIScreenId,
  WalletSlotConfig,
} from './ui-builder.service';
import { TOKENS } from '@app/shared/ztarknet/tokens';

type TransferMode = 'public' | 'private';
type TransferWizardStep = 'select_token' | 'recipient' | 'amount';

interface TransferWizardState {
  mode: TransferMode;
  step: TransferWizardStep;
  tokenIdentifier?: string;
  recipient?: string;
}

@Update()
@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private walletHandler: WalletHandler,
    private usersService: UsersService,
    private readonly uiBuilder: UIBuilderService,
  ) {}

  private transferWizardSessions = new Map<string, TransferWizardState>();

  async onModuleInit() {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'createwallet', description: 'Create a new wallet' },
      { command: 'checkfunding', description: 'Check wallet funding status' },
      { command: 'deploywallet', description: 'Deploy your wallet' },
      { command: 'login', description: 'Unlock your wallet' },
      {
        command: 'balance',
        description: 'Check wallet balance (public/private)',
      },
      { command: 'send', description: 'Send tokens' },
      { command: 'transfer', description: 'Public token transfer' },
      {
        command: 'privatetransfer',
        description: 'Private token transfer (mocked)',
      },
      { command: 'shield', description: 'Shield tokens (mock)' },
      { command: 'unshield', description: 'Unshield tokens (mock)' },
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
      await this.usersService.createOrGetUser(
        telegramId,
        ctx.from?.username,
        ctx.from?.first_name,
        ctx.from?.last_name,
      );

      await ctx.reply('👋 *Welcome to Zkpal Bot V1.0*\n\n', {
        parse_mode: 'Markdown',
      });
      await this.renderDashboard(ctx);
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
    await ctx.answerCbQuery('Dashboard refreshed');
  }

  @Action('onboarding:create_wallet')
  async handleOnboardingCreateWallet(@Ctx() ctx: Context) {
    await this.walletHandler.handleCreateWallet(ctx);
    await ctx.answerCbQuery('Creating wallet...');
  }

  @Action('onboarding:check_balance')
  async handleOnboardingCheckBalance(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    try {
      const message =
        await this.walletHandler.buildPublicBalanceView(telegramId);
      await this.renderWalletDialog(ctx, message, [
        [Markup.button.callback('⬅️ Back', 'refresh:dashboard')],
      ]);
      await ctx.answerCbQuery('Balance checked');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'balance:public')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'refresh:dashboard')],
      ]);
      await ctx.answerCbQuery('Failed to check balance', { show_alert: true });
    }
  }

  @Action('onboarding:deploy_wallet')
  async handleOnboardingDeployWallet(@Ctx() ctx: Context) {
    await this.walletHandler.handleDeployWallet(ctx);
    await ctx.answerCbQuery('Deploying wallet...');
  }

  @Action('view:wallets')
  async handleWalletsNavigation(@Ctx() ctx: Context) {
    this.resetTransferWizard(ctx.from?.id.toString());
    await this.renderWalletCenter(ctx);
  }

  @Action('wallet:refresh')
  async handleWalletRefresh(@Ctx() ctx: Context) {
    this.resetTransferWizard(ctx.from?.id.toString());
    await this.renderWalletCenter(ctx);
  }

  @Action('wallet:balance')
  async handleWalletBalanceAction(@Ctx() ctx: Context) {
    await this.renderBalancePicker(ctx, true);
    await ctx.answerCbQuery('Select balance type');
  }

  @Action('wallet:history')
  async handleWalletHistoryAction(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    try {
      const message = await this.walletHandler.buildHistoryView(telegramId);
      await this.renderWalletDialog(ctx, message, [
        [Markup.button.callback('🔁 Refresh', 'wallet:history')],
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
      await ctx.answerCbQuery('History requested');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'wallet:history')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
      await ctx.answerCbQuery('Failed to load history', { show_alert: true });
    }
  }

  @Action('wallet:transfer_public')
  async handleTransferPublicAction(@Ctx() ctx: Context) {
    await this.startTransferWizard(ctx, 'public');
  }

  @Action('wallet:transfer_private')
  async handleTransferPrivateAction(@Ctx() ctx: Context) {
    await this.startTransferWizard(ctx, 'private');
  }

  @Action('wallet:shield')
  async handleShieldAction(@Ctx() ctx: Context) {
    await this.renderWalletDialog(ctx, this.buildTokenAmountHint('shield'), [
      [Markup.button.callback('⬅️ Back', 'view:wallets')],
    ]);
    await ctx.answerCbQuery('Use /shield');
  }

  @Action('wallet:unshield')
  async handleUnshieldAction(@Ctx() ctx: Context) {
    await this.renderWalletDialog(ctx, this.buildTransferHint('unshield'), [
      [Markup.button.callback('⬅️ Back', 'view:wallets')],
    ]);
    await ctx.answerCbQuery('Use /unshield');
  }

  @Action(/transfer:token/)
  async handleTransferTokenSelection(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    const data = (ctx.callbackQuery as any)?.data || '';
    const { payload } = this.parseCallbackData(data);
    const mode = payload.type as TransferMode;
    const symbol = payload.symbol;

    if (!mode || !symbol || !this.isSupportedToken(symbol)) {
      await ctx.answerCbQuery('Unsupported token', { show_alert: true });
      return;
    }

    const wizard = this.transferWizardSessions.get(telegramId);
    if (!wizard || wizard.mode !== mode) {
      this.transferWizardSessions.set(telegramId, {
        mode,
        step: 'recipient',
        tokenIdentifier: symbol,
      });
    } else {
      wizard.step = 'recipient';
      wizard.tokenIdentifier = symbol;
      wizard.recipient = undefined;
      this.transferWizardSessions.set(telegramId, wizard);
    }

    await this.renderTransferRecipientPrompt(ctx, mode, symbol);
    await ctx.answerCbQuery(`${symbol.toUpperCase()} selected`);
  }

  @Action('transfer:cancel')
  async handleTransferCancel(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    this.resetTransferWizard(telegramId);
    await this.renderWalletCenter(ctx);
    await ctx.answerCbQuery('Transfer cancelled');
  }

  @Action('unlock:cancel')
  async handleUnlockCancel(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (telegramId) {
      const pending = this.walletHandler.getPendingOperation(telegramId);
      if (pending && pending.type === 'unlock_wallet_inline') {
        // Delete password prompt message if it exists
        await this.walletHandler.deletePasswordMessages(ctx, telegramId);
        this.walletHandler.clearPendingOperation(telegramId);
      }
    }
    await this.renderWalletCenter(ctx);
    await ctx.answerCbQuery('Unlock cancelled');
  }

  @Action('balance:public')
  async handlePublicBalanceAction(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    try {
      const message =
        await this.walletHandler.buildPublicBalanceView(telegramId);
      await this.renderWalletDialog(ctx, message, [
        [Markup.button.callback('🔁 Refresh', 'balance:public')],
        [Markup.button.callback('⬅️ Back', 'wallet:balance')],
      ]);
      await ctx.answerCbQuery('Public balance requested');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'balance:public')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'wallet:balance')],
      ]);
      await ctx.answerCbQuery('Failed to load balance', { show_alert: true });
    }
  }

  @Action('balance:private')
  async handlePrivateBalanceAction(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    try {
      const message = await this.walletHandler.buildPrivateBalanceView(
        telegramId,
        ctx.from?.username,
      );
      await this.renderWalletDialog(ctx, message, [
        [Markup.button.callback('🔁 Refresh', 'balance:private')],
        [Markup.button.callback('⬅️ Back', 'wallet:balance')],
      ]);
      await ctx.answerCbQuery('Private balance requested');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'balance:private')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'wallet:balance')],
      ]);
      await ctx.answerCbQuery('Failed to load balance', { show_alert: true });
    }
  }

  async renderDashboard(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usersService.getUserByTelegramId(telegramId);

    // If no wallet, show creation flow
    if (!user || !user.isWalletCreated) {
      await this.renderWalletCreationFlow(ctx);
      return;
    }

    const wallet = await this.walletHandler.getWalletByUserId(
      user._id.toString(),
    );

    // If wallet not found or not deployed, show deployment flow
    if (!wallet || !wallet.isDeployed) {
      await this.renderWalletDeploymentFlow(ctx, wallet);
      return;
    }

    // Wallet exists and is deployed, show normal dashboard
    const walletAddress = await this.getPrimaryWalletAddress(telegramId);
    const copy = this.buildDashboardCopy(walletAddress);
    await this.renderScreen(ctx, copy, 'dashboard');
  }

  async renderWalletCenter(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usersService.getUserByTelegramId(telegramId);

    // If no wallet, show creation flow
    if (!user || !user.isWalletCreated) {
      await this.renderWalletCreationFlow(ctx);
      return;
    }

    const wallet = await this.walletHandler.getWalletByUserId(
      user._id.toString(),
    );

    // If wallet not found or not deployed, show deployment flow
    if (!wallet || !wallet.isDeployed) {
      await this.renderWalletDeploymentFlow(ctx, wallet);
      return;
    }

    // Wallet exists and is deployed, show wallet center
    const { walletSlots, walletAddress } =
      await this.resolveWalletContext(telegramId);
    const copy = this.buildWalletCopy(walletAddress);
    await this.renderScreen(ctx, copy, 'wallets:home', { walletSlots });
  }

  private async renderWalletCreationFlow(ctx: Context) {
    const copy =
      'Create your secure wallet to begin using Zkpal Bot.\n\n' +
      '🔒 Your wallet will be secured with a password.\n' +
      '⚠️ *Important:* Keep your password safe and never share it! \n\n';

    const buttons: InlineKeyboardButton[][] = [
      [Markup.button.callback('✨ Create Wallet', 'onboarding:create_wallet')],
      [Markup.button.callback('🔄 Refresh', 'refresh:dashboard')],
    ];

    await this.renderWalletDialog(ctx, copy, buttons);
  }

  async renderWalletDeploymentFlow(ctx: Context, wallet: any) {
    if (!wallet) {
      await this.renderWalletCreationFlow(ctx);
      return;
    }

    const copy =
      '⚠️ *Action Required*\n\n' +
      'Your wallet needs to be deployed before use.\n\n' +
      '📋 *Next Steps:*\n' +
      '1. Send some STRK tokens to the address above\n' +
      '2. Verify funding status\n' +
      '3. Deploy your wallet\n\n' +
      '💡 Minimum required: ~0.01 STRK (for deployment fees)';

    const buttons: InlineKeyboardButton[][] = [
      [
        Markup.button.callback('💰 Check Balance', 'onboarding:check_balance'),
        Markup.button.callback('🚀 Deploy Wallet', 'onboarding:deploy_wallet'),
      ],
      [Markup.button.callback('🔄 Refresh', 'refresh:dashboard')],
    ];

    await this.renderWalletDialog(ctx, copy, buttons);
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
    const lines = [''];

    if (walletAddress) {
      lines.push(`Active Wallet: \`${walletAddress}\``);
    } else {
      lines.push('No wallet connected yet.');
    }

    return lines.join('\n');
  }

  private getCommandArguments(ctx: Context): string[] {
    const text = (ctx.message as any)?.text || '';
    return text
      .split(' ')
      .slice(1)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  }

  private async renderBalancePicker(ctx: Context, includeBackButton: boolean) {
    const rows: InlineKeyboardButton[][] = [
      [Markup.button.callback('🌐 Public balance', 'balance:public')],
      [Markup.button.callback('🛡️ Private balance', 'balance:private')],
    ];

    if (includeBackButton) {
      rows.push([Markup.button.callback('⬅️ Back', 'view:wallets')]);
    }

    await this.renderWalletDialog(
      ctx,
      'Choose which balance you want to check:',
      rows,
    );
  }

  private async startTransferWizard(ctx: Context, mode: TransferMode) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery?.('Unable to identify user', {
        show_alert: true,
      });
      return;
    }

    this.transferWizardSessions.set(telegramId, {
      mode,
      step: 'select_token',
    });

    await this.renderTransferTokenPicker(ctx, mode);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(
        `Select a token to ${
          mode === 'public' ? 'transfer' : 'privately transfer'
        }`,
      );
    }
  }

  private async renderTransferTokenPicker(ctx: Context, mode: TransferMode) {
    const tokensArray = Object.values(TOKENS);
    const tokenRows = this.chunkButtons(
      tokensArray.map((token) =>
        Markup.button.callback(
          token.attributes.symbol.toUpperCase(),
          `transfer:token|type=${mode}&symbol=${token.attributes.symbol}`,
        ),
      ),
      2,
    );

    const footer: InlineKeyboardButton[][] = [
      [Markup.button.callback('⬅️ Wallet Center', 'view:wallets')],
    ];

    await this.renderWalletDialog(
      ctx,
      mode === 'public'
        ? 'Select a token to send publicly:'
        : 'Select a token to transfer privately:',
      [...tokenRows, ...footer],
    );
  }

  private async renderTransferRecipientPrompt(
    ctx: Context,
    mode: TransferMode,
    tokenSymbol: string,
  ) {
    const helperText =
      mode === 'public'
        ? `📮 Enter the Starknet address to send ${tokenSymbol.toUpperCase()} to.\n\n` +
          '_Reply with the recipient address (must start with 0x)._'
        : `📮 Enter the recipient username to send ${tokenSymbol.toUpperCase()} to.\n\n` +
          '_Reply with the recipient username._';
    await this.renderWalletDialog(
      ctx,
      helperText,
      this.buildTransferPromptButtons(mode),
    );

    await this.sendForceReplyPrompt(
      ctx,
      `Enter ${tokenSymbol.toUpperCase()} recipient address (must start with 0x):`,
    );
  }

  private async renderTransferAmountPrompt(
    ctx: Context,
    mode: TransferMode,
    tokenSymbol: string,
  ) {
    const helperText =
      `💸 Enter the amount of ${tokenSymbol.toUpperCase()} to send.\n\n` +
      '_Reply with a positive number._';

    await this.renderWalletDialog(
      ctx,
      helperText,
      this.buildTransferPromptButtons(mode),
    );

    await this.sendForceReplyPrompt(
      ctx,
      `Enter ${tokenSymbol.toUpperCase()} amount to send:`,
    );
  }
  private async sendForceReplyPrompt(ctx: Context, message: string) {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        force_reply: true,
        selective: true,
      },
    });
  }

  private buildTransferPromptButtons(mode: TransferMode) {
    return [
      [
        Markup.button.callback(
          '🔁 Choose another token',
          this.getTransferActionName(mode),
        ),
      ],
      [Markup.button.callback('⬅️ Wallet Center', 'view:wallets')],
    ];
  }

  private getTransferActionName(mode: TransferMode) {
    return mode === 'public'
      ? 'wallet:transfer_public'
      : 'wallet:transfer_private';
  }

  private chunkButtons(
    buttons: InlineKeyboardButton[],
    size: number,
  ): InlineKeyboardButton[][] {
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += size) {
      rows.push(buttons.slice(i, i + size));
    }
    return rows;
  }

  private isSupportedToken(symbol: string) {
    const tokensArray = Object.values(TOKENS);
    return tokensArray.some(
      (token) => token.attributes.symbol.toLowerCase() === symbol.toLowerCase(),
    );
  }

  private resetTransferWizard(telegramId?: string) {
    if (!telegramId) return;
    this.transferWizardSessions.delete(telegramId);
  }

  private async handleTransferWizardInput(
    ctx: Context,
    wizard: TransferWizardState,
    text: string,
  ): Promise<boolean> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return false;

    if (wizard.step === 'select_token') {
      await ctx.reply('Please pick a token first to continue.');
      return true;
    }

    if (wizard.step === 'recipient') {
      if (wizard.mode === 'public' && !text.startsWith('0x')) {
        await ctx.reply(
          '❌ Invalid address. Please provide a Starknet address starting with 0x.',
        );
        return true;
      }

      wizard.recipient = text.trim();
      wizard.step = 'amount';
      this.transferWizardSessions.set(telegramId, wizard);
      await this.renderTransferAmountPrompt(
        ctx,
        wizard.mode,
        wizard.tokenIdentifier ?? 'token',
      );
      return true;
    }

    if (wizard.step === 'amount') {
      if (isNaN(Number(text)) || Number(text) <= 0) {
        await ctx.reply('❌ Invalid amount. Please enter a positive number.');
        return true;
      }
      const args = [
        text.trim(),
        wizard.mode,
        wizard.tokenIdentifier ?? '',
        wizard.recipient ?? '',
      ];

      this.transferWizardSessions.delete(telegramId);

      if (!args[1] || !args[2]) {
        await ctx.reply(
          '❌ Missing token or recipient. Please restart transfer.',
        );
        return true;
      }

      const actionName =
        wizard.mode === 'public'
          ? 'transfer:public_wizard'
          : 'transfer:private_wizard';

      try {
        if (wizard.mode === 'public') {
          await this.walletHandler.handleSend(ctx, args);
        } else {
          await this.walletHandler.handlePrivateTransfer(ctx, args);
        }
      } catch (error) {
        const actionToContinue = this.buildInlineActionWithPayload(actionName, {
          amount: args[0],
          mode: wizard.mode,
          token: wizard.tokenIdentifier ?? '',
          recipient: wizard.recipient ?? '',
        });

        if (await this.handleLockedWalletError(ctx, error, actionToContinue)) {
          return true;
        }

        await this.renderWalletDialog(ctx, this.formatInlineError(error), [
          [Markup.button.callback('⬅️ Back', 'view:wallets')],
        ]);
      }
      return true;
    }

    return false;
  }

  private buildTransferHint(
    command: 'transfer' | 'privatetransfer' | 'unshield',
  ) {
    return (
      `Use /${command} with amount, token and recipient.\n\n` +
      `Format: /${command} <amount> <token_symbol_or_address> <recipient_address>\n` +
      `Example: /${command} 3 strk 0x123...`
    );
  }

  private buildTokenAmountHint(command: 'shield') {
    return (
      `Use /${command} with amount and token symbol or token address.\n\n` +
      `Format: /${command} <amount> <token_symbol_or_address>\n` +
      `Example: /${command} 2 strk`
    );
  }

  private async renderWalletDialog(
    ctx: Context,
    body: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<number | undefined> {
    const telegramId = ctx.from?.id.toString();
    const { walletAddress } = await this.resolveWalletContext(telegramId);
    const sections = [this.buildWalletCopy(walletAddress)];

    if (body) {
      sections.push(body);
    }

    const copy = sections.filter(Boolean).join('\n\n');
    const keyboardMarkup = Markup.inlineKeyboard(buttons);
    const responseOptions = {
      parse_mode: 'Markdown' as const, //!TODO Monitor
      reply_markup: keyboardMarkup.reply_markup,
    };

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(copy, responseOptions);

        return (ctx.callbackQuery?.message as any)?.message_id;
      } catch {
        const message = await ctx.reply(copy, responseOptions);
        return (message as any)?.message_id;
      }
    }

    const message = await ctx.reply(copy, responseOptions);
    return (message as any)?.message_id;
  }

  private formatInlineError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return '❌ Unable to complete the request.';
  }

  /**
   * Handle locked wallet error by prompting for password inline
   */
  private async handleLockedWalletError(
    ctx: Context,
    error: unknown,
    actionToContinue: string,
  ): Promise<boolean> {
    const errorMessage =
      error instanceof Error ? error.message.toLowerCase() : '';
    const isLockedError =
      errorMessage.includes('locked') || errorMessage.includes('unlock');

    if (!isLockedError) {
      return false;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      return false;
    }

    // Set up inline unlock operation
    await this.walletHandler.setupInlineUnlock(
      ctx,
      telegramId,
      actionToContinue,
    );

    // Render dialog and store prompt message ID
    const promptMessage = await this.renderWalletDialog(
      ctx,
      '🔐 *Wallet Locked*\n\nPlease enter your password to unlock:',
      [[Markup.button.callback('⬅️ Cancel', 'unlock:cancel')]],
    );

    if (promptMessage) {
      const messageIds =
        this.walletHandler.getPasswordMessageIds(telegramId) || {};
      messageIds.promptMessageId = promptMessage;
      this.walletHandler.setPasswordMessageIds(telegramId, messageIds);
    }

    await ctx.answerCbQuery('Wallet locked - enter password');
    return true;
  }

  /**
   * Handle inline unlock and continue with original action
   */
  private async handleInlineUnlockAndContinue(
    ctx: Context,
    password: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    try {
      const actionToContinue =
        await this.walletHandler.handleInlineUnlockPassword(ctx, password);

      if (!actionToContinue) {
        return;
      }

      await this.continueActionAfterUnlock(ctx, actionToContinue);
    } catch (error) {
      await ctx.reply(
        `❌ ${error instanceof Error ? error.message : 'Invalid password'}`,
      );
    }
  }

  /**
   * Continueoriginal action after successful unlock
   */
  private async continueActionAfterUnlock(
    ctx: Context,
    action: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const { action: actionName, payload } = this.parseCallbackData(action);

    try {
      //  handle router
      switch (actionName) {
        case 'balance:public': {
          const message =
            await this.walletHandler.buildPublicBalanceView(telegramId);
          await this.renderWalletDialog(ctx, message, [
            [Markup.button.callback('🔁 Refresh', 'balance:public')],
            [Markup.button.callback('⬅️ Back', 'wallet:balance')],
          ]);
          break;
        }
        case 'balance:private': {
          const message = await this.walletHandler.buildPrivateBalanceView(
            telegramId,
            ctx.from?.username,
          );
          await this.renderWalletDialog(ctx, message, [
            [Markup.button.callback('🔁 Refresh', 'balance:private')],
            [Markup.button.callback('⬅️ Back', 'wallet:balance')],
          ]);
          break;
        }
        case 'wallet:history': {
          const message = await this.walletHandler.buildHistoryView(telegramId);
          await this.renderWalletDialog(ctx, message, [
            [Markup.button.callback('🔁 Refresh', 'wallet:history')],
            [Markup.button.callback('⬅️ Back', 'view:wallets')],
          ]);
          break;
        }
        case 'transfer:public_wizard': {
          const amount = payload.amount;
          const token = payload.token;
          const recipient = payload.recipient;
          if (!amount || !token || !recipient) {
            await this.renderWalletCenter(ctx);
            break;
          }
          const args = [amount, 'public', token, recipient];
          await this.walletHandler.handleSend(ctx, args);
          break;
        }
        case 'transfer:private_wizard': {
          const amount = payload.amount;
          const token = payload.token;
          const recipient = payload.recipient;
          if (!amount || !token || !recipient) {
            await this.renderWalletCenter(ctx);
            break;
          }
          const args = [amount, 'private', token, recipient];
          await this.walletHandler.handlePrivateTransfer(ctx, args);
          break;
        }
        default:
          // If action is not recognized, just show wallet center
          await this.renderWalletCenter(ctx);
      }
    } catch (error) {
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
    }
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

  /**
   * Build an action string with serialized payload (similar to callback_data)
   */
  private buildInlineActionWithPayload(
    action: string,
    payload: Record<string, string>,
  ): string {
    const serialized = Object.entries(payload)
      .filter(([_, value]) => Boolean(value))
      .map(
        ([key, value]) =>
          `${key}=${encodeURIComponent(value.toString().slice(0, 32))}`,
      )
      .join('&');

    return serialized ? `${action}|${serialized}` : action;
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
    const args = this.getCommandArguments(ctx);
    if (args[0]?.toLowerCase() === 'private') {
      await this.walletHandler.handlePrivateBalance(ctx);
      return;
    }

    if (args[0]?.toLowerCase() === 'public') {
      await this.walletHandler.handleBalance(ctx);
      return;
    }

    await this.renderBalancePicker(ctx, false);
  }

  @Command('send')
  async onSend(ctx: Context) {
    const text = (ctx.message as any)?.text || '';
    const args = text.split(' ').slice(1);
    try {
      await this.walletHandler.handleSend(ctx, args);
    } catch (error) {
      await ctx.reply(this.formatInlineError(error));
    }
  }

  @Command('history')
  async onHistory(ctx: Context) {
    await this.walletHandler.handleHistory(ctx);
  }

  @Command('transfer')
  async onTransfer(ctx: Context) {
    const args = this.getCommandArguments(ctx);
    try {
      await this.walletHandler.handlePublicTransfer(ctx, args);
    } catch (error) {
      await ctx.reply(this.formatInlineError(error));
    }
  }

  @Command('privatetransfer')
  async onPrivateTransfer(ctx: Context) {
    const args = this.getCommandArguments(ctx);
    try {
      await this.walletHandler.handlePrivateTransfer(ctx, args);
    } catch (error) {
      await ctx.reply(this.formatInlineError(error));
    }
  }

  @Command('shield')
  async onShield(ctx: Context) {
    const args = this.getCommandArguments(ctx);
    await this.walletHandler.handleShieldToken(ctx, args);
  }

  @Command('unshield')
  async onUnshield(ctx: Context) {
    const args = this.getCommandArguments(ctx);
    await this.walletHandler.handleUnshieldToken(ctx, args);
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
    if (text.startsWith('/')) {
      this.resetTransferWizard(telegramId);
      return;
    }

    const wizard = this.transferWizardSessions.get(telegramId);
    if (wizard) {
      const handled = await this.handleTransferWizardInput(ctx, wizard, text);
      if (handled) {
        return;
      }
    }

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
      case 'unlock_wallet_inline':
        await this.handleInlineUnlockAndContinue(ctx, text);
        break;
      case 'send_token':
        await this.walletHandler.handleSendConfirmation(ctx, text);
        break;
      case 'deploy_wallet':
        await this.walletHandler.handleDeployPassword(ctx, text);
        break;
      case 'shield_token':
        await this.walletHandler.handleShieldTokenConfirmation(ctx, text);
        break;
      case 'private_transact':
        await this.walletHandler.handlePrivateTransactConfirmation(ctx, text);
        break;
      case 'unshield_token':
        await this.walletHandler.handleUnshieldTokenConfirmation(ctx, text);
        break;
      default:
        await ctx.reply('Unknown operation. Please try again.');
    }
  }
}
