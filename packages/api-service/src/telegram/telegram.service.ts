/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot, Command, Update, On, Action, Ctx } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';
import { WalletHandler } from './handlers/wallet.handler';
import { UsersService } from '../users/users.service';
import { SessionService } from '../auth/session.service';
import { WalletService } from '../wallet/wallet.service';
import {
  BuildKeyboardOptions,
  UIBuilderService,
  UIScreenId,
  WalletSlotConfig,
} from './ui-builder.service';
import { TOKENS } from '@app/shared/ztarknet/tokens';
import { SwapService } from '../wallet/swap.service';

type TransferMode = 'public' | 'private';
type TransferWizardStep = 'select_token' | 'recipient' | 'amount';

interface TransferWizardState {
  mode: TransferMode;
  step: TransferWizardStep;
  tokenIdentifier?: string;
  recipient?: string;
}

type SwapWizardStep =
  | 'select_token_in'
  | 'select_token_out'
  | 'enter_amount'
  | 'confirm';

interface SwapWizardState {
  step: SwapWizardStep;
  tokenIn?: string;
  tokenOut?: string;
  amount?: string;
  amountOut?: string;
}

@Update()
@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private walletHandler: WalletHandler,
    private usersService: UsersService,
    private sessionService: SessionService,
    private walletService: WalletService,
    private swapService: SwapService,
    private readonly uiBuilder: UIBuilderService,
  ) {}

  private transferWizardSessions = new Map<string, TransferWizardState>();
  private swapWizardSessions = new Map<string, SwapWizardState>();

  async onModuleInit() {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the zkpal' },
      { command: 'createwallet', description: 'Create a new wallet' },
      { command: 'deploywallet', description: 'Deploy your wallet' },
      { command: 'login', description: 'Unlock your wallet' },

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

      await ctx.reply('👋 *Welcome to Zkpal V1.0*\n\n', {
        parse_mode: 'Markdown',
      });
      await this.renderDashboard(ctx);
    } catch (error) {
      await ctx.reply(`${error.message}`);
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
      '/deploywallet - Deploy your wallet after funding\n' +
      '/login - Unlock your wallet with password\n' +
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

  @Action('wallet:export_key')
  async handleExportPrivateKeyAction(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    try {
      const { walletAddress, privateKey } =
        await this.walletHandler.exportPrivateKey(telegramId);
      const messageId = await this.renderPrivateKeyExport(
        ctx,
        walletAddress,
        privateKey,
      );
      const chatId = (ctx.chat as any)?.id;
      this.schedulePrivateKeyDeletion(chatId, messageId);
      await ctx.answerCbQuery('Private key shown');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'wallet:export_key')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
      await ctx.answerCbQuery('Failed to export key', { show_alert: true });
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

  @Action('wallet:create_new')
  async handleCreateNewWalletAction(@Ctx() ctx: Context) {
    await this.walletHandler.startRotateWalletFlow(ctx);
    await ctx.answerCbQuery('Creating new wallet...');
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

  @Action('wallet:swap')
  async handleSwapAction(@Ctx() ctx: Context) {
    await this.startSwapWizard(ctx);
    await ctx.answerCbQuery('Starting swap...');
  }

  @Action(/swap:token_in/)
  async handleSwapTokenInSelection(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    const data = (ctx.callbackQuery as any)?.data || '';
    const { payload } = this.parseCallbackData(data);
    const tokenSymbol = payload.sym;

    if (!tokenSymbol) {
      await ctx.answerCbQuery('Invalid token', { show_alert: true });
      return;
    }

    // Find token address from symbol
    const tokenAddress = this.walletService.findTokenAddress(tokenSymbol);
    if (!tokenAddress) {
      await ctx.answerCbQuery('Token not found', { show_alert: true });
      return;
    }

    const wizard = this.swapWizardSessions.get(telegramId) || {
      step: 'select_token_in' as SwapWizardStep,
    };
    wizard.tokenIn = tokenAddress;
    wizard.step = 'select_token_out';
    this.swapWizardSessions.set(telegramId, wizard);

    await this.renderSwapTokenOutPicker(ctx, tokenAddress);
    await ctx.answerCbQuery('Token selected');
  }

  @Action(/swap:token_out/)
  async handleSwapTokenOutSelection(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    const data = (ctx.callbackQuery as any)?.data || '';
    const { payload } = this.parseCallbackData(data);
    const tokenSymbol = payload.sym;

    if (!tokenSymbol) {
      await ctx.answerCbQuery('Invalid token', { show_alert: true });
      return;
    }

    // Find token address from symbol
    const tokenOutAddress = this.walletService.findTokenAddress(tokenSymbol);
    if (!tokenOutAddress) {
      await ctx.answerCbQuery('Token not found', { show_alert: true });
      return;
    }

    const wizard = this.swapWizardSessions.get(telegramId);
    if (!wizard || !wizard.tokenIn) {
      await ctx.answerCbQuery('Please select input token first', {
        show_alert: true,
      });
      return;
    }

    if (wizard.tokenIn.toLowerCase() === tokenOutAddress.toLowerCase()) {
      await ctx.answerCbQuery('Cannot swap same token', { show_alert: true });
      return;
    }

    wizard.tokenOut = tokenOutAddress;
    wizard.step = 'enter_amount';
    this.swapWizardSessions.set(telegramId, wizard);

    await this.renderSwapAmountPrompt(ctx, wizard.tokenIn, tokenOutAddress);
    await ctx.answerCbQuery('Token selected');
  }

  @Action('swap:cancel')
  async handleSwapCancel(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    this.resetSwapWizard(telegramId);
    await this.renderWalletCenter(ctx);
    await ctx.answerCbQuery('Swap cancelled');
  }

  @Action('swap:confirm')
  async handleSwapConfirm(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery('Unable to identify user', { show_alert: true });
      return;
    }

    const wizard = this.swapWizardSessions.get(telegramId);
    if (!wizard || !wizard.tokenIn || !wizard.tokenOut || !wizard.amount) {
      await ctx.answerCbQuery('Invalid swap data', { show_alert: true });
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.answerCbQuery('Wallet not found', { show_alert: true });
        return;
      }

      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        // Set up inline unlock
        await this.walletHandler.setupInlineUnlock(
          ctx,
          telegramId,
          'swap:confirm',
        );
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
        return;
      }

      // Store pending operation for password confirmation
      const pendingOperation = {
        type: 'swap_token',
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
        tokenIn: wizard.tokenIn,
        tokenOut: wizard.tokenOut,
        amount: wizard.amount,
        amountOut: wizard.amountOut,
      };

      // Store pending operation using the handler's method
      const pendingOps = (this.walletHandler as any).pendingOperations;
      if (pendingOps) {
        pendingOps.set(telegramId, pendingOperation);
      }

      // Prompt for password
      const promptMessage = await ctx.reply(
        '🔐 Please confirm by entering your password:',
      );
      const messageIds =
        this.walletHandler.getPasswordMessageIds(telegramId) || {};
      messageIds.promptMessageId = (promptMessage as any)?.message_id;
      this.walletHandler.setPasswordMessageIds(telegramId, messageIds);

      this.resetSwapWizard(telegramId);
      await ctx.answerCbQuery('Enter password to confirm');
    } catch (error) {
      await ctx.answerCbQuery('Error: ' + error.message, { show_alert: true });
    }
  }

  @Action('wallet:reset_wallet_password')
  async handleResetWalletAction(@Ctx() ctx: Context) {
    await this.walletHandler.startResetPasswordWallet(ctx);
    await ctx.answerCbQuery('Reseting wallet Password...');
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
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
      await ctx.answerCbQuery('Public balance requested');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'balance:public')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
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
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
      ]);
      await ctx.answerCbQuery('Private balance requested');
    } catch (error) {
      if (await this.handleLockedWalletError(ctx, error, 'balance:private')) {
        return;
      }
      await this.renderWalletDialog(ctx, this.formatInlineError(error), [
        [Markup.button.callback('⬅️ Back', 'view:wallets')],
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

    const balance = await this.walletHandler.buildPublicBalanceView(telegramId);

    await this.renderScreen(ctx, balance, 'dashboard');
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
    const { walletSlots } = await this.resolveWalletContext(telegramId);
    const balance = await this.walletHandler.buildPublicBalanceView(telegramId);
    await this.renderScreen(ctx, balance, 'wallets:home', { walletSlots });
  }

  private async renderWalletCreationFlow(ctx: Context) {
    const copy =
      'Create your secure wallet to begin using Zkpal .\n\n' +
      '🔒 Your wallet will be secured with a password.\n' +
      '⚠️ *Important:* Keep your password safe and never share it! \n\n';

    const buttons: InlineKeyboardButton[][] = [
      [
        Markup.button.callback(
          '✨ Create New Wallet',
          'onboarding:create_wallet',
        ),
      ],

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
      [Markup.button.callback('🚀 Deploy Wallet', 'onboarding:deploy_wallet')],
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

  private async renderPrivateKeyExport(
    ctx: Context,
    walletAddress: string,
    privateKey: string,
  ): Promise<number | undefined> {
    const body =
      '🔑 *Private Key Export*\n\n' +
      `Wallet: \`${walletAddress}\`\n` +
      `Private Key: \`${privateKey}\`\n\n` +
      '_This message auto-deletes in 10 seconds._\n\n' +
      '⚠️ Anyone with this key can control your funds. Store it securely.';

    return this.renderWalletDialog(ctx, body, [
      [Markup.button.callback('⬅️ Back', 'view:wallets')],
    ]);
  }

  private schedulePrivateKeyDeletion(
    chatId?: number,
    messageId?: number,
    delayMs = 10000,
  ): void {
    if (!chatId || !messageId) return;

    const timer = setTimeout(async () => {
      try {
        await this.bot.telegram.deleteMessage(chatId, messageId);
      } catch (error) {
        console.warn(
          `Failed to auto-delete private key message ${messageId}: ${
            (error as Error).message
          }`,
        );
      }
    }, delayMs);

    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  }

  private getCommandArguments(ctx: Context): string[] {
    const text = (ctx.message as any)?.text || '';
    return text
      .split(' ')
      .slice(1)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
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
        ? `📮 Enter the Starknet address to send ${tokenSymbol.toUpperCase()} to.\n\n`
        : `📮 Enter the recipient username to send ${tokenSymbol.toUpperCase()} to.\n\n`;
    await this.renderWalletDialog(
      ctx,
      ``,
      this.buildTransferPromptButtons(mode),
    );

    await this.sendForceReplyPrompt(ctx, helperText);
  }

  private async renderTransferAmountPrompt(
    ctx: Context,
    mode: TransferMode,
    tokenSymbol: string,
  ) {
    const helperText = `💸 Enter the amount of ${tokenSymbol.toUpperCase()} to send.\n\n`;

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
      `Format: /${command} \`<amount>\` \`<token_symbol_or_address>\`\n` +
      `Example: /${command} 2 strk`
    );
  }

  private async renderWalletDialog(
    ctx: Context,
    body: string,
    buttons: InlineKeyboardButton[][],
  ): Promise<number | undefined> {
    const telegramId = ctx.from?.id.toString();

    const balance = await this.walletHandler.buildPublicBalanceView(telegramId);
    const privateBalances = await this.walletHandler.buildPrivateBalanceView(
      telegramId,
      ctx.from?.username,
    );
    const sections = [balance, privateBalances];

    if (body) {
      sections.push(body);
    }

    const copy = sections.filter(Boolean).join('\n\n');
    const keyboardMarkup = Markup.inlineKeyboard(buttons);
    const responseOptions = {
      // parse_mode: 'Markdown' as const, //!TODO Monitor
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
    // Only answer callback queries when this handler is invoked from a button.
    if (ctx.callbackQuery && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery('Wallet locked - enter password');
    }
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
            [Markup.button.callback('⬅️ Back', 'view:wallets')],
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
            [Markup.button.callback('⬅️ Back', 'view:wallets')],
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
        case 'wallet:export_key': {
          const { walletAddress, privateKey } =
            await this.walletHandler.exportPrivateKey(telegramId);
          const messageId = await this.renderPrivateKeyExport(
            ctx,
            walletAddress,
            privateKey,
          );
          const chatId = (ctx.chat as any)?.id;
          this.schedulePrivateKeyDeletion(chatId, messageId);
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

  // @Command('logout')
  // async onLogout(ctx: Context) {
  //   await this.walletHandler.handleLogout(ctx);
  // }

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

    // Check for transfer wizard input
    const wizard = this.transferWizardSessions.get(telegramId);
    if (wizard) {
      const handled = await this.handleTransferWizardInput(ctx, wizard, text);
      if (handled) {
        return;
      }
    }

    // Check for swap wizard input (before pending operations)
    const swapWizard = this.swapWizardSessions.get(telegramId);
    if (swapWizard && swapWizard.step === 'enter_amount') {
      const handled = await this.handleSwapWizardInput(ctx, swapWizard, text);
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
      case 'rotate_wallet':
        await this.walletHandler.handleRotateWalletPassword(ctx, text);
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
      case 'reset_wallet_password':
        await this.walletHandler.handleResetPasswordWallet(ctx, text);
        break;
      case 'swap_token':
        await this.walletHandler.handleSwapConfirmation(ctx, text);
        break;
      default:
        await ctx.reply('Unknown operation. Please try again.');
    }
  }

  private async startSwapWizard(ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.answerCbQuery?.('Unable to identify user', {
        show_alert: true,
      });
      return;
    }

    // Initialize with default token (STRK)
    const defaultToken = this.swapService.getDefaultToken();
    this.swapWizardSessions.set(telegramId, {
      step: 'select_token_in',
      tokenIn: defaultToken,
    });

    await this.renderSwapTokenInPicker(ctx);
  }

  private async renderSwapTokenInPicker(ctx: Context) {
    const tokens = this.swapService.getAvailableTokens();
    const defaultToken = this.swapService.getDefaultToken();

    const tokenRows = this.chunkButtons(
      await Promise.all(
        tokens.map(async (token, index) => {
          const price = await this.swapService.getPrice(token.address);
          const isDefault =
            token.address.toLowerCase() === defaultToken.toLowerCase();
          // Use symbol instead of full address to keep callback_data under 64 bytes
          return Markup.button.callback(
            `${token.symbol} ($${price.toFixed(2)})${isDefault ? ' ✓' : ''}`,
            `swap:token_in|sym=${token.symbol.toLowerCase()}`,
          );
        }),
      ),
      1,
    );

    const footer: InlineKeyboardButton[][] = [
      [Markup.button.callback('❌ Cancel', 'swap:cancel')],
    ];

    await this.renderWalletDialog(
      ctx,
      '🔄 *Token Private Swap*\n\n' +
        'Step 1/4: Choose the token you want to swap\n\n' +
        '_Select the token you want to swap FROM:_',
      [...tokenRows, ...footer],
    );
  }

  private async renderSwapTokenOutPicker(ctx: Context, tokenInAddress: string) {
    const tokens = this.swapService.getAvailableTokens();
    const tokenInSymbol = this.swapService.getTokenSymbol(tokenInAddress);

    // Filter out the selected input token
    const availableTokens = tokens.filter(
      (t) => t.address.toLowerCase() !== tokenInAddress.toLowerCase(),
    );

    const tokenRows = this.chunkButtons(
      await Promise.all(
        availableTokens.map(async (token) => {
          const price = await this.swapService.getPrice(token.address);
          // Use symbol instead of full address to keep callback_data under 64 bytes
          return Markup.button.callback(
            `${token.symbol} ($${price.toFixed(2)})`,
            `swap:token_out|sym=${token.symbol.toLowerCase()}`,
          );
        }),
      ),
      1,
    );

    const footer: InlineKeyboardButton[][] = [
      [Markup.button.callback('⬅️ Back', 'wallet:swap')],
      [Markup.button.callback('❌ Cancel', 'swap:cancel')],
    ];

    await this.renderWalletDialog(
      ctx,
      '🔄 *Token Private Swap*\n\n' +
        `Step 2/4: Choose target token\n\n` +
        `Swapping FROM: *${tokenInSymbol}*\n` +
        `_Select the token you want to swap TO:_`,
      [...tokenRows, ...footer],
    );
  }

  private async renderSwapAmountPrompt(
    ctx: Context,
    tokenInAddress: string,
    tokenOutAddress: string,
  ) {
    const tokenInSymbol = this.swapService.getTokenSymbol(tokenInAddress);
    const tokenOutSymbol = this.swapService.getTokenSymbol(tokenOutAddress);

    const footer: InlineKeyboardButton[][] = [
      [Markup.button.callback('⬅️ Back', 'wallet:swap')],
      [Markup.button.callback('❌ Cancel', 'swap:cancel')],
    ];

    await this.renderWalletDialog(
      ctx,
      '🔄 *Token Private Swap*\n\n' +
        `Step 3/4: Enter amount\n\n` +
        `Swapping: *${tokenInSymbol}* → *${tokenOutSymbol}*\n\n` +
        `_Enter the amount of ${tokenInSymbol} you want to swap:_`,
      footer,
    );

    await this.sendForceReplyPrompt(
      ctx,
      `Enter ${tokenInSymbol} amount to swap:`,
    );
  }

  private async renderSwapConfirmation(
    ctx: Context,
    tokenInAddress: string,
    tokenOutAddress: string,
    amount: string,
    amountOut: string,
  ) {
    // Get detailed swap overview
    const overview = await this.swapService.getSwapOverview(
      tokenInAddress,
      tokenOutAddress,
      amount,
    );

    const buttons: InlineKeyboardButton[][] = [
      [Markup.button.callback('✅ Confirm Swap', 'swap:confirm')],
      [Markup.button.callback('❌ Cancel', 'swap:cancel')],
    ];

    const message =
      '🔄 *Token Private Swap*\n\n' +
      `*Step 4/4: Confirm Swap*\n\n` +
      `*Swap Details:*\n` +
      `• *From:* \`${overview.from.amount} ${overview.from.symbol}\`\n` +
      `• *To:* \`${overview.to.symbol}\`\n` +
      `• *Est. Value:* ${overview.estimatedValue}\n` +
      `• *Est. Output:* \`${overview.estimatedOutput}\`\n` +
      `• *Route:* \`${overview.route}\`\n\n` +
      `▲ *Important Notes:*\n` +
      `• Prices may change before execution\n` +
      `• Gas fees will apply\n` +
      `• This action cannot be undone\n\n` +
      `_Ready to swap?_`;

    await this.renderWalletDialog(ctx, message, buttons);
  }

  private async handleSwapWizardInput(
    ctx: Context,
    wizard: SwapWizardState,
    text: string,
  ): Promise<boolean> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return false;

    if (wizard.step !== 'enter_amount') {
      return false;
    }

    // Validate amount
    if (!this.swapService.validateAmount(text)) {
      await ctx.reply(
        '❌ Invalid amount. Please enter a valid positive number.',
      );
      return true;
    }

    if (!wizard.tokenIn || !wizard.tokenOut) {
      await ctx.reply('❌ Missing token selection. Please restart swap.');
      return true;
    }

    try {
      // Simulate swap to get output amount
      const amountOut = await this.swapService.simulateSwap(
        wizard.tokenIn,
        wizard.tokenOut,
        text,
      );

      wizard.amount = text.trim();
      wizard.amountOut = amountOut;
      wizard.step = 'confirm';
      this.swapWizardSessions.set(telegramId, wizard);

      await this.renderSwapConfirmation(
        ctx,
        wizard.tokenIn,
        wizard.tokenOut,
        wizard.amount,
        wizard.amountOut,
      );
      return true;
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
      return true;
    }
  }

  private resetSwapWizard(telegramId?: string) {
    if (!telegramId) return;
    this.swapWizardSessions.delete(telegramId);
  }
}
