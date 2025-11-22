/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { UsersService } from '../../users/users.service';
import { WalletService } from '../../wallet/wallet.service';
import { SessionService } from '../../auth/session.service';
import { TransactionService } from '../../wallet/transaction.service';

import { PASSWORD_CONFIG } from 'shared/utils/constants';

@Injectable()
export class WalletHandler {
  private pendingOperations = new Map<string, any>();
  // Store message IDs for password prompts and user messages (for auto-delete)
  private passwordMessageIds = new Map<
    string,
    { promptMessageId?: number; userMessageId?: number }
  >();

  constructor(
    private usersService: UsersService,
    private walletService: WalletService,
    private sessionService: SessionService,
    private transactionService: TransactionService,
  ) {}

  /**
   * Handle /createwallet command
   */
  async handleCreateWallet(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      // Get or create user
      const user = await this.usersService.createOrGetUser(
        telegramId,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );

      // Check if wallet already exists
      if (user.isWalletCreated) {
        const wallet = await this.walletService.getWalletByUserId(
          user._id.toString(),
        );
        if (wallet) {
          await ctx.reply(
            `✅ Wallet already exists!\n\n` +
              `Address: \`${wallet.address}\`\n\n` +
              `Use /balance to check your balance\n` +
              `Use /send to send tokens`,
            { parse_mode: 'Markdown' },
          );
          return;
        }
      }

      // Prompt for password
      this.pendingOperations.set(telegramId, {
        type: 'create_wallet',
        userId: user._id.toString(),
      });

      // Store prompt message ID for auto-delete
      const promptMessage = await ctx.reply(
        '🔐 Please enter a strong password for your wallet:\n\n' +
          `Requirements:\n` +
          `• Minimum ${PASSWORD_CONFIG.MIN_LENGTH} characters\n` +
          `• At least one uppercase letter\n` +
          `• At least one lowercase letter\n` +
          `• At least one number\n\n` +
          `⚠️ This password will be used to unlock your wallet. Keep it safe!`,
      );

      this.passwordMessageIds.set(telegramId, {
        promptMessageId: (promptMessage as any).message_id,
      });
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle password input for wallet creation
   */
  async handlePasswordInput(ctx: Context, password: string): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'create_wallet') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    try {
      // Validate password
      if (!this.validatePassword(password)) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);

        await ctx.reply(
          '❌ Password does not meet requirements. Please try again:\n\n' +
            `• Minimum ${PASSWORD_CONFIG.MIN_LENGTH} characters\n` +
            `• At least one uppercase letter\n` +
            `• At least one lowercase letter\n` +
            `• At least one number`,
        );
        return;
      }

      // Create wallet address (not deployed yet)
      const { wallet, address } = await this.walletService.createWalletAddress(
        pending.userId,
        password,
      );

      // Create session
      const session = await this.sessionService.createSession(
        pending.userId,
        telegramId,
        wallet.passwordHash,
      );

      // Update user
      await this.usersService.updateWalletStatus(pending.userId, true);

      // Delete password messages
      await this.deletePasswordMessages(ctx, telegramId);

      // Clear pending operation
      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Wallet address generated!\n\n` +
          `📍 Address: \`${address}\`\n\n` +
          `⚠️ **Important:** Before you can use your wallet, you need to fund it with some Starknet tokens.\n\n` +
          `📝 **Next Steps:**\n` +
          `1. Send some Starknet tokens to the address above\n` +
          `2. Use /checkfunding to verify the funding\n` +
          `3. Use /deploywallet to deploy your account\n\n` +
          `💡 Minimum required: ~0.01 STRK (for deployment fees)`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Failed to create wallet: ${error.message}`);
    }
  }

  /**
   * Handle /login command
   */
  async handleLogin(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const wallet = await this.walletService.getWalletByUserId(
        user._id.toString(),
      );
      if (!wallet) {
        await ctx.reply('❌ Wallet not found.');
        return;
      }

      // Get or create session
      let session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session) {
        session = await this.sessionService.createSession(
          user._id.toString(),
          telegramId,
          wallet.passwordHash,
        );
      }

      // Check if already unlocked
      if (session.isWalletUnlocked()) {
        await ctx.reply('✅ Wallet is already unlocked!');
        return;
      }

      // Prompt for password
      this.pendingOperations.set(telegramId, {
        type: 'unlock_wallet',
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
      });

      const promptMessage = await ctx.reply(
        '🔐 Please enter your password to unlock your wallet:',
      );
      this.passwordMessageIds.set(telegramId, {
        promptMessageId: (promptMessage as any).message_id,
      });
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle password input for unlock
   */
  async handleUnlockPassword(ctx: Context, password: string): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'unlock_wallet') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    try {
      const wallet = await this.walletService.getWalletByUserId(pending.userId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Unlock wallet
      await this.sessionService.unlockWallet(
        pending.sessionToken,
        password,
        wallet.encryptedPrivateKey,
        wallet.encryptionSalt,
        wallet.iv,
        wallet.address,
      );

      // Delete password messages
      await this.deletePasswordMessages(ctx, telegramId);

      // Clear pending operation
      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        '✅ Wallet unlocked successfully!\n\n' +
          'You can now:\n' +
          '• Check balance: /balance\n' +
          '• Send tokens: /send\n' +
          '• View history: /history\n' +
          '• Lock wallet: /logout',
      );
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ ${error.message}`);
    }
  }

  /**
   * Handle /balance command
   */
  async handleBalance(ctx: Context, tokenAddress?: string): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const wallet = await this.walletService.getWalletByUserId(
        user._id.toString(),
      );
      if (!wallet) {
        await ctx.reply('❌ Wallet not found.');
        return;
      }

      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        await ctx.reply(
          '❌ Wallet is locked. Please unlock it first with /login',
        );
        return;
      }

      const balance = await this.walletService.getBalance(
        wallet.address,
        tokenAddress,
      );
      const tokenSymbol = tokenAddress ? 'Token' : 'STRK';

      await ctx.reply(
        `💰 Balance\n\n` +
          `Address: \`${wallet.address}\`\n` +
          `${tokenSymbol}: ${balance}`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle /send command
   */
  async handleSend(ctx: Context, args: string[]): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        await ctx.reply(
          '❌ Wallet is locked. Please unlock it first with /login',
        );
        return;
      }

      if (args.length < 3) {
        await ctx.reply(
          '❌ Invalid format. Use:\n' +
            '`/send <amount> <token_address> <recipient_address>`\n\n' +
            'Example: `/send 100 0x123... 0x456...`',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const [amount, tokenAddress, recipientAddress] = args;

      // Prompt for password confirmation
      this.pendingOperations.set(telegramId, {
        type: 'send_token',
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
        amount,
        tokenAddress,
        recipientAddress,
      });

      // Store prompt message ID for auto-delete
      const promptMessage = await ctx.reply(
        '🔐 Please confirm by entering your password:',
      );
      this.passwordMessageIds.set(telegramId, {
        promptMessageId: (promptMessage as any).message_id,
      });
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle password confirmation for send
   */
  async handleSendConfirmation(ctx: Context, password: string): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'send_token') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        await ctx.reply('❌ Invalid password. Transaction cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Execute transaction
      const transaction = await this.transactionService.sendToken(
        pending.userId,
        pending.sessionToken,
        pending.recipientAddress,
        pending.amount,
        pending.tokenAddress,
      );

      // Delete password messages
      await this.deletePasswordMessages(ctx, telegramId);

      // Clear pending operation
      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Transaction sent!\n\n` +
          `Hash: \`${transaction.txHash}\`\n` +
          `Amount: ${pending.amount}\n` +
          `To: \`${pending.recipientAddress}\`\n\n` +
          `Status: ${transaction.status}`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Transaction failed: ${error.message}`);
    }
  }

  /**
   * Handle /history command
   */
  async handleHistory(ctx: Context, limit: number = 10): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const transactions = await this.transactionService.getTransactionHistory(
        user._id.toString(),
        limit,
      );

      if (transactions.length === 0) {
        await ctx.reply('📝 No transactions found.');
        return;
      }

      let message = '📝 Transaction History\n\n';
      transactions.forEach((tx, index) => {
        message += `${index + 1}. ${tx.type.toUpperCase()}\n`;
        message += `   Hash: \`${tx.txHash}\`\n`;
        message += `   Amount: ${tx.amount}\n`;
        message += `   Status: ${tx.status}\n\n`;
      });

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle /logout command
   */
  async handleLogout(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (session) {
        await this.sessionService.lockWallet(session.sessionToken);
        await ctx.reply('🔒 Wallet locked successfully.');
      } else {
        await ctx.reply('No active session found.');
      }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle /checkfunding command
   */
  async handleCheckFunding(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const wallet = await this.walletService.getWalletByUserId(
        user._id.toString(),
      );
      if (!wallet) {
        await ctx.reply('❌ Wallet not found.');
        return;
      }

      if (wallet.isDeployed) {
        await ctx.reply('✅ Wallet is already deployed and ready to use!');
        return;
      }

      // const fundingStatus = await this.walletService.checkWalletFundingStatus(
      //   user._id.toString(),
      // );

      // if (fundingStatus.isFunded) {
      //   await ctx.reply(
      //     `✅ Wallet is funded and ready for deployment!\n\n` +
      //       `💰 Current Balance: ${fundingStatus.balance}\n\n` +
      //       `Use /deploywallet to deploy your account.`,
      //   );
      // } else {
      //   let requireSTRK = '0.01';
      //   if (fundingStatus.requiredAmount) {
      //     try {
      //       const requiredWei = BigInt(fundingStatus.requiredAmount);
      //       const strkDivisor = BigInt('100000000000000'); // 0.001 STRK in wei
      //       const strkValue = Number(requiredWei) / Number(strkDivisor);
      //       requireSTRK = strkValue.toFixed(6);
      //     } catch (e) {
      //       // Fallback to default
      //       requireSTRK = '0.001';
      //     }
      //   }
      //   await ctx.reply(
      //     `⏳ Wallet is not yet funded.\n\n` +
      //       `📍 Address: \`${wallet.address}\`\n` +
      //       `💰 Current Balance: ${fundingStatus.balance}\n` +
      //       `💵 Required: ~${requireSTRK} STRK (for deployment fees)\n\n` +
      //       `📝 **Next Steps:**\n` +
      //       `1. Send at least ${requireSTRK} STRK to the address above\n` +
      //       `2. Wait for the transaction to confirm\n` +
      //       `3. Use /checkfunding again to verify\n` +
      //       `4. Use /deploywallet to deploy your account`,
      //     { parse_mode: 'Markdown' },
      //   );
      // }
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle /deploywallet command
   */
  async handleDeployWallet(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const wallet = await this.walletService.getWalletByUserId(
        user._id.toString(),
      );
      if (!wallet) {
        await ctx.reply('❌ Wallet not found.');
        return;
      }

      if (wallet.isDeployed) {
        await ctx.reply('✅ Wallet is already deployed!');
        return;
      }

      // Get or create session
      let session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session) {
        session = await this.sessionService.createSession(
          user._id.toString(),
          telegramId,
          wallet.passwordHash,
        );
      }

      // Prompt for password
      this.pendingOperations.set(telegramId, {
        type: 'deploy_wallet',
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
      });

      // Store prompt message ID for auto-delete
      const promptMessage = await ctx.reply(
        '🔐 Please enter your password to deploy your wallet:',
      );
      this.passwordMessageIds.set(telegramId, {
        promptMessageId: (promptMessage as any).message_id,
      });
    } catch (error) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle password input for wallet deployment
   */
  async handleDeployPassword(ctx: Context, password: string): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'deploy_wallet') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        await ctx.reply('❌ Invalid password. Deployment cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Deploy wallet
      await ctx.reply('⏳ Deploying your wallet... This may take a moment.');

      const { transactionHash, contractAddress } =
        await this.walletService.deployWallet(pending.userId, password);

      // Delete password messages
      await this.deletePasswordMessages(ctx, telegramId);

      // Clear pending operation
      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Wallet deployed successfully!\n\n` +
          `📍 Contract Address: \`${contractAddress}\`\n` +
          `📝 Transaction Hash: \`${transactionHash}\`\n\n` +
          `🎉 Your wallet is now ready to use!\n` +
          `Use /login to unlock your wallet for transactions.`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Deployment failed: ${error.message}`);
    }
  }

  /**
   * Check if user has pending operation
   */
  hasPendingOperation(telegramId: string): boolean {
    return this.pendingOperations.has(telegramId);
  }

  /**
   * Get pending operation
   */
  getPendingOperation(telegramId: string): any {
    return this.pendingOperations.get(telegramId);
  }

  /**
   * Get wallet by user ID (helper method)
   */
  async getWalletByUserId(userId: string) {
    return this.walletService.getWalletByUserId(userId);
  }

  /**
   * Delete password messages (bot prompt and user's password message)
   */
  private async deletePasswordMessages(
    ctx: Context,
    telegramId: string,
  ): Promise<void> {
    try {
      const messageIds = this.passwordMessageIds.get(telegramId);
      if (!messageIds) return;

      const chatId = (ctx.chat as any)?.id;
      if (!chatId) return;

      // Delete bot's prompt message
      if (messageIds.promptMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, messageIds.promptMessageId);
        } catch (error) {
          // Ignore errors (message might already be deleted or not accessible)
          console.warn(`Failed to delete prompt message: ${error.message}`);
        }
      }

      // Delete user's password message
      if (messageIds.userMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, messageIds.userMessageId);
        } catch (error) {
          // Ignore errors (message might already be deleted or not accessible)
          console.warn(`Failed to delete user message: ${error.message}`);
        }
      }

      // Clear stored message IDs
      this.passwordMessageIds.delete(telegramId);
    } catch (error) {
      // Silently fail - don't interrupt the flow if deletion fails
      console.warn(`Error deleting password messages: ${error.message}`);
    }
  }

  /**
   * Validate password strength
   */
  private validatePassword(password: string): boolean {
    if (password.length < PASSWORD_CONFIG.MIN_LENGTH) return false;
    if (PASSWORD_CONFIG.REQUIRE_UPPERCASE && !/[A-Z]/.test(password))
      return false;
    if (PASSWORD_CONFIG.REQUIRE_LOWERCASE && !/[a-z]/.test(password))
      return false;
    if (PASSWORD_CONFIG.REQUIRE_NUMBER && !/[0-9]/.test(password)) return false;
    return true;
  }
}
