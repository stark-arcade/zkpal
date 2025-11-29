/* eslint-disable @typescript-eslint/no-explicit-any */
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Context } from 'telegraf';
import { UsersService } from '../../users/users.service';
import { WalletService } from '../../wallet/wallet.service';
import { SessionService } from '../../auth/session.service';
import { TransactionService } from '../../wallet/transaction.service';
import { Prove } from '../../prove/prove.service';
import { formatUnits, parseUnits } from 'ethers';
import { PASSWORD_CONFIG } from 'shared/utils/constants';
import { TelegramService } from '../telegram.service';
import { CommitmentService } from '../../commitment/commitment.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

type ParsedTransferPayload = {
  amount: string;
  tokenIdentifier: string;
  recipientAddress: string;
};

type ParsedTokenAmountPayload = {
  amount: string;
  tokenIdentifier: string;
};

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
    @Inject(forwardRef(() => TelegramService))
    private telegramService: TelegramService,
    private commitmentService: CommitmentService,
    @InjectConnection() private connection: Connection,
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

      const { wallet } = await this.walletService.createWalletAddress(
        pending.userId,
        password,
      );

      // Create session
      await this.sessionService.createSession(
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

      // Show brief success message
      await ctx.reply('✅ Wallet created successfully!', {
        parse_mode: 'Markdown',
      });

      // Render the deployment flow (which shows the address and next steps)
      await this.telegramService.renderWalletDeploymentFlow(ctx, wallet);
    } catch (error) {
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
        // Render the dashboard
        await this.telegramService.renderDashboard(ctx);
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

      await ctx.reply('✅ Wallet unlocked successfully!');

      // Render the dashboard
      await this.telegramService.renderDashboard(ctx);
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ ${error.message}`);
    }
  }

  /**
   * Setup inline unlock operation (from dashboard actions)
   */
  async setupInlineUnlock(
    ctx: Context,
    telegramId: string,
    actionToContinue: string,
  ): Promise<void> {
    const user = await this.usersService.getUserByTelegramId(telegramId);
    if (!user || !user.isWalletCreated) {
      throw new Error(
        '❌ Wallet not found. Please create a wallet first with /createwallet',
      );
    }

    const wallet = await this.walletService.getWalletByUserId(
      user._id.toString(),
    );
    if (!wallet) {
      throw new Error('❌ Wallet not found.');
    }

    // Get or create session
    let session = await this.sessionService.getSessionByTelegramId(telegramId);
    if (!session) {
      session = await this.sessionService.createSession(
        user._id.toString(),
        telegramId,
        wallet.passwordHash,
      );
    }

    // Store pending operation with action to continue
    this.pendingOperations.set(telegramId, {
      type: 'unlock_wallet_inline',
      userId: user._id.toString(),
      sessionToken: session.sessionToken,
      actionToContinue,
    });
  }

  /**
   * Handle password input for inline unlock (from dashboard)
   */
  async handleInlineUnlockPassword(
    ctx: Context,
    password: string,
  ): Promise<string | null> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return null;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'unlock_wallet_inline') return null;

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

      // Get action to continue
      const actionToContinue = pending.actionToContinue;

      // Delete password messages
      await this.deletePasswordMessages(ctx, telegramId);

      // Clear pending operation
      this.pendingOperations.delete(telegramId);

      // Return action to continue (caller will handle it)
      return actionToContinue;
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      throw error;
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
      const message = await this.buildPublicBalanceView(
        telegramId,
        tokenAddress,
      );
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(this.formatErrorMessage(error));
    }
  }

  /**
   * Handle private balance requests (mock data)
   */
  async handlePrivateBalance(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    try {
      const message = await this.buildPrivateBalanceView(
        telegramId,
        ctx.from?.username,
      );
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(this.formatErrorMessage(error));
    }
  }

  /**
   * Handle /send command
   * Supports formats:
   * - /send <amount> <token_symbol> to <recipient_address>
   * - /send <amount> <token_symbol> <recipient_address>
   * - /send <amount> <token_address> <recipient_address>
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

      const transferPayload = await this.parseTransferCommand(
        ctx,
        args,
        'send',
      );
      if (!transferPayload) {
        return;
      }

      // Find token address from identifier (symbol or address)
      const tokenAddress = this.walletService.findTokenAddress(
        transferPayload.tokenIdentifier,
      );
      if (!tokenAddress) {
        await ctx.reply(
          `❌ Token not found: "${transferPayload.tokenIdentifier}".\n\n` +
            `Please use a valid token symbol (e.g., "strk") or token contract address.`,
        );
        return;
      }

      // Prompt for password confirmation
      this.pendingOperations.set(telegramId, {
        type: 'send_token',
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
        amount: transferPayload.amount,
        tokenAddress,
        tokenIdentifier: transferPayload.tokenIdentifier, // Store original identifier for display
        recipientAddress: transferPayload.recipientAddress,
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

  async handlePublicTransfer(ctx: Context, args: string[]): Promise<void> {
    await this.handleSend(ctx, args);
  }

  async handlePrivateTransfer(ctx: Context, args: string[]): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    const transferPayload = await this.parseTransferCommand(
      ctx,
      args,
      'privatetransfer',
    );
    if (!transferPayload) {
      return;
    }

    const chatId = (ctx.chat as any)?.id;
    let sendingMessageId: number | undefined;
    try {
      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        await ctx.reply(
          '❌ Wallet is locked. Please unlock it first with /login',
        );
        return;
      }
      const tokenAddress = this.walletService.findTokenAddress(
        transferPayload.tokenIdentifier,
      );
      if (!tokenAddress) {
        await ctx.reply(
          `❌ Token not found: "${transferPayload.tokenIdentifier}".\n\n` +
            `Please use a valid token symbol (e.g., "strk") or token contract address.`,
        );
        return;
      }

      const user = await this.usersService.getUserByTelegramId(telegramId);
      if (!user || !user.isWalletCreated) {
        await ctx.reply(
          '❌ Wallet not found. Please create a wallet first with /createwallet',
        );
        return;
      }

      const recipientUser = await this.usersService.getUserByTelegramUsername(
        transferPayload.recipientAddress,
      );

      if (!recipientUser) {
        await ctx.reply(
          `❌ User not found: "${transferPayload.recipientAddress}".\n\n` +
            `This occurs when the recipient is not yet using ZkPal.`,
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

      const parsedAmountToSend = parseUnits(transferPayload.amount, 18);
      const totalBalance = await this.commitmentService.getPrivateBalance(
        telegramId,
        tokenAddress,
      );
      const parsedTotal = parseUnits(totalBalance, 18);

      if (parsedAmountToSend > parsedTotal) {
        await ctx.reply(
          `❌ Insufficient balance. You only have ${totalBalance}`,
        );
        return;
      }

      try {
        const sendingMessage = await ctx.reply('🚀 Generating ZK proof...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch (error) {
        throw new Error(error);
      }

      const latestNoteIndexSender =
        await this.commitmentService.getLatestNote(telegramId);
      const latestNoteIndexRec = await this.commitmentService.getLatestNote(
        transferPayload.recipientAddress,
      );

      // Get all commitments that satisfies the transact condition
      const oldCommitments =
        await this.commitmentService.getCommitmentsForTransact(
          telegramId,
          tokenAddress,
          parsedAmountToSend,
        );

      // calculate change amount of old commitments
      const changeAmount =
        oldCommitments.reduce(
          (acc, curr) => acc + parseUnits(curr.amount, 18),
          0n,
        ) - parsedAmountToSend;

      // Generate new commitments
      const newCommitments = await Prove.generateTransactCommitment({
        amountToSend: parsedAmountToSend,
        recipient: recipientUser.telegramId,
        recipientNoteIndex: latestNoteIndexRec + 1,
        changeAmount,
        sender: telegramId,
        senderNoteIndex: latestNoteIndexSender + 1,
      });

      // Generate ZK proof
      const zkInput = await Prove.buildZKInput(
        telegramId,
        tokenAddress, // private token
        parsedAmountToSend,
        '0', // tokenOut
        0n,
        recipientUser.telegramId,
        '0',
        oldCommitments,
        newCommitments,
      );

      const zkp = await Prove.generateZKProof(zkInput);

      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }

      // Prompt for password confirmation
      this.pendingOperations.set(telegramId, {
        type: 'private_transact',
        sender: telegramId,
        recipient: recipientUser.telegramId,
        userId: user._id.toString(),
        recipientId: recipientUser._id.toString(),
        sessionToken: session.sessionToken,
        amount: transferPayload.amount,
        amountChange: formatUnits(changeAmount, 18),
        token: tokenAddress,
        tokenIdentifier: transferPayload.tokenIdentifier, // Store original identifier for display
        oldCommitments,
        newCommitments,
        zkProof: zkp,
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

    const chatId = (ctx.chat as any)?.id;
    let verifyingMessageId: number | undefined;
    let sendingMessageId: number | undefined;
    try {
      const verifyingMessage = await ctx.reply('⏳ Verifying password...');
      verifyingMessageId = (verifyingMessage as any)?.message_id;
    } catch {
      //
    }

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        if (chatId && verifyingMessageId) {
          try {
            await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          } catch {
            // ignore
          }
        }
        await ctx.reply('❌ Invalid password. Transaction cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Password verified - update status
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          verifyingMessageId = undefined;
        } catch {
          // ignore deletion errors
        }
      }
      try {
        const sendingMessage = await ctx.reply('🚀 Sending transaction...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch {
        console.log('Error When confirming');
      }

      let tokenSymbol = pending.tokenIdentifier;
      if (pending.tokenIdentifier?.startsWith('0x')) {
        tokenSymbol = pending.tokenIdentifier;
      }

      // Execute transaction
      const transaction = await this.transactionService.sendToken(
        pending.userId,
        pending.sessionToken,
        pending.recipientAddress,
        pending.amount,
        pending.tokenAddress,
        tokenSymbol,
      );

      await this.deletePasswordMessages(ctx, telegramId);

      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Transaction sent!\n\n` +
          `Hash: \`${transaction.txHash}\`\n` +
          `Amount: ${pending.amount} ${tokenSymbol?.toUpperCase() || 'tokens'}\n` +
          `To: \`${pending.recipientAddress}\`\n\n` +
          `Status: ${transaction.status}`,
        { parse_mode: 'Markdown' },
      );
      await this.telegramService.renderWalletCenter(ctx);
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Transaction failed: ${error.message}`);
    } finally {
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
        } catch {
          console.log('Error when delete in send confirming');
        }
      }
      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }
    }
  }

  /**
   * Handle password confirmation for send
   */
  async handlePrivateTransactConfirmation(
    ctx: Context,
    password: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'private_transact') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    const chatId = (ctx.chat as any)?.id;
    let verifyingMessageId: number | undefined;
    let sendingMessageId: number | undefined;
    try {
      const verifyingMessage = await ctx.reply('⏳ Verifying password...');
      verifyingMessageId = (verifyingMessage as any)?.message_id;
    } catch {
      //
    }

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        if (chatId && verifyingMessageId) {
          try {
            await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          } catch {
            // ignore
          }
        }
        await ctx.reply('❌ Invalid password. Transaction cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Password verified - update status
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          verifyingMessageId = undefined;
        } catch {
          // ignore deletion errors
        }
      }
      try {
        const sendingMessage = await ctx.reply('🚀 Sending transaction...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch {
        console.log('Error When confirming');
      }

      let tokenSymbol = pending.tokenIdentifier;
      if (pending.tokenIdentifier?.startsWith('0x')) {
        tokenSymbol = pending.tokenIdentifier;
      }

      // Execute transaction
      const transaction = await this.transactionService.privateTransact(
        pending.userId,
        telegramId,
        pending.sessionToken,
        pending.zkProof,
        pending.oldCommitments.map((commitment) => commitment.commitment),
        {
          rooiIdList: pending.oldCommitments.map(
            (commitment) => commitment.rootId,
          ),
          rootList: pending.oldCommitments.map((commitment) => commitment.root),
          nullifierHashes: pending.oldCommitments.map((commitment) =>
            Prove.shortenCommitment(commitment.nullifier),
          ),
          newCommitment1: Prove.shortenCommitment(
            pending.newCommitments.commitmentRecipient,
          ),
          newCommitment2: pending.newCommitments.commitmentChange
            ? Prove.shortenCommitment(pending.newCommitments.commitmentChange)
            : null,
          tokenOut: '0x0',
          amountOut: '0',
          recipientWithdraw: '0x0',
        },
        {
          recipient: pending.recipient,
          token: pending.token,
          amountToSend: pending.amount,
          amountChange: pending.amountChange,
          newCommitments: pending.newCommitments,
        },
        pending.tokenIdentifier,
      );

      await this.deletePasswordMessages(ctx, telegramId);

      this.pendingOperations.delete(telegramId);

      const receiptUser = await this.usersService.getUserByTelegramId(
        pending.recipient,
      );
      await ctx.reply(
        '🤫 *Private Transfer*\n\n' +
          `Tx Hash: \`${transaction.txHash}\`\n` +
          `Amount: ${pending.amount} ${tokenSymbol}\n` +
          `Recipient: @${receiptUser.telegramUsername}\n` +
          `Token: \`${tokenSymbol}\`\n` +
          '_Your token is secretly sent to the recipient._',
        { parse_mode: 'Markdown' },
      );
      await this.telegramService.renderWalletCenter(ctx);
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Transaction failed: ${error.message}`);
    } finally {
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
        } catch {
          console.log('Error when delete in send confirming');
        }
      }
      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }
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
      const message = await this.buildHistoryView(telegramId, limit);
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(this.formatErrorMessage(error));
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

    let deployingMessageId: number | undefined;

    try {
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        await this.deletePasswordMessages(ctx, telegramId);
        await ctx.reply('❌ Invalid password. Deployment cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Delete password messages immediately after successful verification
      await this.deletePasswordMessages(ctx, telegramId);

      // Show deploying message
      try {
        const deployingMessage = await ctx.reply(
          '⏳ Deploying your wallet... This may take a moment.',
        );
        deployingMessageId = (deployingMessage as any)?.message_id;
      } catch {
        // Ignore failures for optional status message
      }

      const { transactionHash, contractAddress } =
        await this.walletService.deployWallet(pending.userId, password);

      // Delete deploying message
      if (deployingMessageId) {
        try {
          const chatId = (ctx.chat as any)?.id;
          if (chatId) {
            await ctx.telegram.deleteMessage(chatId, deployingMessageId);
          }
        } catch {
          // Ignore deletion errors
        }
      }

      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Wallet deployed successfully!\n\n` +
          `📍 Contract Address: \`${contractAddress}\`\n` +
          `📝 Transaction Hash: \`${transactionHash}\`\n\n` +
          `🎉 Your wallet is now ready to use!`,
        { parse_mode: 'Markdown' },
      );

      // Automatically render the wallet center after successful deployment
      await this.telegramService.renderWalletCenter(ctx);
    } catch (error) {
      // Delete deploying message on error
      if (deployingMessageId) {
        try {
          const chatId = (ctx.chat as any)?.id;
          if (chatId) {
            await ctx.telegram.deleteMessage(chatId, deployingMessageId);
          }
        } catch {
          // Ignore deletion errors
        }
      }

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
   * Clear pending operation
   */
  clearPendingOperation(telegramId: string): void {
    this.pendingOperations.delete(telegramId);
  }

  /**
   * Get password message IDs
   */
  getPasswordMessageIds(telegramId: string) {
    return this.passwordMessageIds.get(telegramId);
  }

  /**
   * Set password message IDs
   */
  setPasswordMessageIds(
    telegramId: string,
    messageIds: { promptMessageId?: number; userMessageId?: number },
  ): void {
    this.passwordMessageIds.set(telegramId, messageIds);
  }

  /**
   * Get wallet by user ID (helper method)
   */
  async getWalletByUserId(userId: string) {
    return this.walletService.getWalletByUserId(userId);
  }

  /**
   * Delete password messages
   */
  async deletePasswordMessages(
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
          console.warn(`Failed to delete prompt message: ${error.message}`);
        }
      }

      // Delete user's password message
      if (messageIds.userMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, messageIds.userMessageId);
        } catch (error) {
          console.warn(`Failed to delete user message: ${error.message}`);
        }
      }

      // Clear stored message IDs
      this.passwordMessageIds.delete(telegramId);
    } catch (error) {
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

  private normalizeArgs(rawArgs: string[]): string[] {
    if (!rawArgs || rawArgs.length === 0) {
      return [];
    }
    return rawArgs
      .map((arg) => arg?.trim())
      .filter((arg): arg is string => Boolean(arg));
  }

  private buildTransferUsageMessage(command: string): string {
    return (
      '❌ Invalid format. Use:\n' +
      `\`/${command} <amount> <token_symbol_or_address> <recipient_address>\`\n\n` +
      'Examples:\n' +
      `• \`/${command} 3 strk 0x123...\`\n` +
      `• \`/${command} 3 strk to 0x123...\`\n` +
      `• \`/${command} 100 0xTokenAddress... 0xRecipient...\``
    );
  }

  private buildTokenAmountUsageMessage(command: string): string {
    return (
      '❌ Invalid format. Use:\n' +
      `\`/${command} <amount> <token_symbol_or_address>\`\n\n` +
      'Examples:\n' +
      `• \`/${command} 4 strk\`\n` +
      `• \`/${command} 2 0xTokenAddress...\``
    );
  }

  private async parseTransferCommand(
    ctx: Context,
    rawArgs: string[],
    command: string,
  ): Promise<ParsedTransferPayload | null> {
    const args = this.normalizeArgs(rawArgs);
    if (args.length < 3) {
      await ctx.reply(this.buildTransferUsageMessage(command), {
        parse_mode: 'Markdown',
      });
      return null;
    }

    let amount: string;
    let mode: string;
    let tokenIdentifier: string;
    let recipientAddress: string;

    if (args.length === 4) {
      [amount, mode, tokenIdentifier, recipientAddress] = args;
    } else if (args.length === 5 && args[3].toLowerCase() === 'to') {
      [amount, mode, tokenIdentifier, , recipientAddress] = args;
    } else {
      recipientAddress = args[args.length - 1];
      tokenIdentifier = args[args.length - 2];
      amount = args[0];
    }

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      await ctx.reply(
        '❌ Invalid amount. Please provide a valid positive number.',
      );
      return null;
    }

    if (
      !recipientAddress ||
      (mode === 'public' && !recipientAddress.startsWith('0x'))
    ) {
      await ctx.reply(
        '❌ Invalid recipient address. Address must start with 0x.',
      );
      return null;
    }

    return {
      amount,
      tokenIdentifier,
      recipientAddress: recipientAddress.replace('@', ''),
    };
  }

  private async parseTokenAmountCommand(
    ctx: Context,
    rawArgs: string[],
    command: string,
  ): Promise<ParsedTokenAmountPayload | null> {
    const args = this.normalizeArgs(rawArgs);
    if (args.length < 2) {
      await ctx.reply(this.buildTokenAmountUsageMessage(command), {
        parse_mode: 'Markdown',
      });
      return null;
    }

    const [amount, tokenIdentifier] = args;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      await ctx.reply(
        '❌ Invalid amount. Please provide a valid positive number.',
      );
      return null;
    }

    return { amount, tokenIdentifier };
  }

  async buildPublicBalanceView(
    telegramId: string,
    tokenAddress?: string,
  ): Promise<string> {
    const { wallet } = await this.resolveUnlockedWalletContext(telegramId);
    const balance = await this.walletService.getBalance(
      wallet.address,
      tokenAddress,
    );
    const tokenSymbol = tokenAddress ? 'Token' : 'STRK';

    return (
      `💰 Balance\n\n` +
      `Address: \`${wallet.address}\`\n` +
      `${tokenSymbol}: ${balance}`
    );
  }

  async buildPrivateBalanceView(
    telegramId: string,
    username?: string,
  ): Promise<string> {
    const { wallet } = await this.resolveWalletContext(telegramId);
    if (!wallet) {
      throw new Error(
        '❌ Wallet not found. Please create a wallet first with /createwallet',
      );
    }

    const ownerLabel = username ? `@${username}` : telegramId;

    const balances =
      await this.commitmentService.getPrivateBalanceList(telegramId);

    let message = `🛡️ Private Balances\n\nOwner: ${ownerLabel}\n\n💰 Balances:`;
    for (const balance of balances) {
      message += `\n- ${balance.token}: ${balance.amount}`;
    }
    return message;
  }

  async buildHistoryView(
    telegramId: string,
    limit: number = 10,
  ): Promise<string> {
    const user = await this.usersService.getUserByTelegramId(telegramId);
    if (!user) {
      throw new Error('❌ User not found.');
    }

    const transactions = await this.transactionService.getTransactionHistory(
      user._id.toString(),
      limit,
    );

    if (transactions.length === 0) {
      return '📝 No transactions found.';
    }

    let message = '📝 Transaction History\n\n';
    transactions.forEach((tx, index) => {
      message += `${index + 1}. ${tx.type.toUpperCase()}\n`;
      message += `   Hash: \`${tx.txHash}\`\n`;
      message += `   Amount: ${tx.amount}\n`;
      message += `   Status: ${tx.status}\n\n`;
    });

    return message;
  }

  private async resolveUnlockedWalletContext(telegramId: string) {
    const context = await this.resolveWalletContext(telegramId);
    const { wallet } = context;
    if (!wallet) {
      throw new Error(
        '❌ Wallet not found. Please create a wallet first with /createwallet',
      );
    }

    const session =
      await this.sessionService.getSessionByTelegramId(telegramId);
    if (!session || !session.isWalletUnlocked()) {
      throw new Error(
        '❌ Wallet is locked. Please unlock it first with /login',
      );
    }

    return { wallet, session };
  }

  private async resolveWalletContext(telegramId: string) {
    const user = await this.usersService.getUserByTelegramId(telegramId);
    if (!user || !user.isWalletCreated) {
      return { wallet: null, user: null };
    }

    const wallet = await this.walletService.getWalletByUserId(
      user._id.toString(),
    );
    return { wallet, user };
  }

  private formatErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message.startsWith('❌')
        ? error.message
        : `❌ ${error.message}`;
    }
    return '❌ Unexpected error occurred.';
  }

  /**
   * Shield Token Contract
   */
  async handleShieldToken(ctx: Context, args: string[]): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    const payload = await this.parseTokenAmountCommand(ctx, args, 'shield');
    if (!payload) {
      return;
    }

    try {
      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        await ctx.reply(
          '❌ Wallet is locked. Please unlock it first with /login',
        );
        return;
      }

      const tokenAddress = this.walletService.findTokenAddress(
        payload.tokenIdentifier,
      );
      if (!tokenAddress) {
        await ctx.reply(
          `❌ Token not found: "${payload.tokenIdentifier}".\n\n` +
            `Please use a valid token symbol (e.g., "strk") or token contract address.`,
        );
        return;
      }

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

      const latestNoteIndex =
        await this.commitmentService.getLatestNote(telegramId);
      const parsedAmount = parseUnits(payload.amount, 18);

      const commitmemt = await Prove.generateShieldCommitment({
        recipient: telegramId,
        amount: parsedAmount,
        noteIndex: latestNoteIndex + 1,
      });

      // Prompt for password confirmation
      this.pendingOperations.set(telegramId, {
        type: 'shield_token',
        telegramId,
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
        amount: payload.amount,
        tokenAddress,
        tokenIdentifier: payload.tokenIdentifier, // Store original identifier for display
        commitment: commitmemt,
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
   * Unshield Token Contract From telegram Command (mocked)
   */
  async handleUnshieldToken(ctx: Context, args: string[]): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      await ctx.reply('Unable to identify user.');
      return;
    }

    const payload = await this.parseTransferCommand(ctx, args, 'unshield');
    if (!payload) {
      return;
    }

    try {
      const session =
        await this.sessionService.getSessionByTelegramId(telegramId);
      if (!session || !session.isWalletUnlocked()) {
        await ctx.reply(
          '❌ Wallet is locked. Please unlock it first with /login',
        );
        return;
      }
      const tokenAddress = this.walletService.findTokenAddress(
        payload.tokenIdentifier,
      );
      if (!tokenAddress) {
        await ctx.reply(
          `❌ Token not found: "${payload.tokenIdentifier}".\n\n` +
            `Please use a valid token symbol (e.g., "strk") or token contract address.`,
        );
        return;
      }

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

      const parsedAmountToSend = parseUnits(payload.amount, 18);
      const totalBalance = await this.commitmentService.getPrivateBalance(
        telegramId,
        tokenAddress,
      );
      const parsedTotal = parseUnits(totalBalance, 18);

      if (parsedAmountToSend > parsedTotal) {
        await ctx.reply(
          `❌ Insufficient balance. You only have ${totalBalance}`,
        );
        return;
      }

      const chatId = (ctx.chat as any)?.id;
      let sendingMessageId: number | undefined;

      try {
        const sendingMessage = await ctx.reply('🚀 Generating ZK proof...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch (error) {
        throw new Error(error);
      }

      const latestNoteIndexSender =
        await this.commitmentService.getLatestNote(telegramId);

      // Get all commitments that satisfies the transact condition
      const oldCommitments =
        await this.commitmentService.getCommitmentsForTransact(
          telegramId,
          tokenAddress,
          parsedAmountToSend,
        );

      // calculate change amount of old commitments
      const changeAmount =
        oldCommitments.reduce(
          (acc, curr) => acc + parseUnits(curr.amount, 18),
          0n,
        ) - parsedAmountToSend;

      // Generate new commitments
      const newCommitments = await Prove.generateTransactCommitment({
        amountToSend: parsedAmountToSend,
        recipient: payload.recipientAddress,
        recipientNoteIndex: Date.now(),
        changeAmount,
        sender: telegramId,
        senderNoteIndex: latestNoteIndexSender + 1,
      });

      // Generate ZK proof
      const zkInput = await Prove.buildZKInput(
        telegramId,
        tokenAddress, // private token
        parsedAmountToSend,
        tokenAddress, // tokenOut
        parsedAmountToSend,
        payload.recipientAddress,
        payload.recipientAddress,
        oldCommitments,
        newCommitments,
      );

      const zkp = await Prove.generateZKProof(zkInput);

      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }

      // Prompt for password confirmation
      this.pendingOperations.set(telegramId, {
        type: 'unshield_token',
        sender: telegramId,
        recipient: payload.recipientAddress,
        userId: user._id.toString(),
        sessionToken: session.sessionToken,
        amount: payload.amount,
        amountChange: formatUnits(changeAmount, 18),
        token: tokenAddress,
        tokenIdentifier: payload.tokenIdentifier, // Store original identifier for display
        oldCommitments,
        newCommitments,
        zkProof: zkp,
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
  async handleShieldTokenConfirmation(
    ctx: Context,
    password: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'shield_token') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    const chatId = (ctx.chat as any)?.id;
    let verifyingMessageId: number | undefined;
    let sendingMessageId: number | undefined;
    try {
      const verifyingMessage = await ctx.reply('⏳ Verifying password...');
      verifyingMessageId = (verifyingMessage as any)?.message_id;
    } catch {
      //
    }

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        if (chatId && verifyingMessageId) {
          try {
            await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          } catch {
            // ignore
          }
        }
        await ctx.reply('❌ Invalid password. Transaction cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Password verified - update status
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          verifyingMessageId = undefined;
        } catch {
          // ignore deletion errors
        }
      }
      try {
        const sendingMessage = await ctx.reply('🚀 Sending transaction...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch {
        console.log('Error When confirming');
      }

      let tokenSymbol = pending.tokenIdentifier;
      if (pending.tokenIdentifier?.startsWith('0x')) {
        tokenSymbol = pending.tokenIdentifier;
      }

      // Execute transaction
      const transaction = await this.transactionService.shieldToken(
        pending.userId,
        telegramId,
        pending.sessionToken,
        pending.amount,
        pending.tokenAddress,
        pending.commitment,
        tokenSymbol,
      );

      await this.deletePasswordMessages(ctx, telegramId);

      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Transaction sent!\n\n` +
          `Hash: \`${transaction.txHash}\`\n` +
          `Amount: ${pending.amount} ${tokenSymbol?.toUpperCase() || 'tokens'}\n` +
          // `To: \`${pending.recipientAddress}\`\n\n` +
          `Status: ${transaction.status}`,
        { parse_mode: 'Markdown' },
      );
      await this.telegramService.renderWalletCenter(ctx);
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Transaction failed: ${error.message}`);
    } finally {
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
        } catch {
          console.log('Error when delete in send confirming');
        }
      }
      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }
    }
  }

  /**
   * Handle password confirmation for unshield
   */
  async handleUnshieldTokenConfirmation(
    ctx: Context,
    password: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const pending = this.pendingOperations.get(telegramId);
    if (!pending || pending.type !== 'unshield_token') return;

    // Store user's password message ID for deletion
    const userMessageId = (ctx.message as any)?.message_id;
    const messageIds = this.passwordMessageIds.get(telegramId) || {};
    messageIds.userMessageId = userMessageId;
    this.passwordMessageIds.set(telegramId, messageIds);

    const chatId = (ctx.chat as any)?.id;
    let verifyingMessageId: number | undefined;
    let sendingMessageId: number | undefined;
    try {
      const verifyingMessage = await ctx.reply('⏳ Verifying password...');
      verifyingMessageId = (verifyingMessage as any)?.message_id;
    } catch {
      //
    }

    try {
      // Verify password
      const isValid = await this.sessionService.verifyPassword(
        pending.sessionToken,
        password,
      );

      if (!isValid) {
        // Delete password messages
        await this.deletePasswordMessages(ctx, telegramId);
        if (chatId && verifyingMessageId) {
          try {
            await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          } catch {
            // ignore
          }
        }
        await ctx.reply('❌ Invalid password. Transaction cancelled.');
        this.pendingOperations.delete(telegramId);
        return;
      }

      // Password verified - update status
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
          verifyingMessageId = undefined;
        } catch {
          // ignore deletion errors
        }
      }
      try {
        const sendingMessage = await ctx.reply('🚀 Sending transaction...');
        sendingMessageId = (sendingMessage as any)?.message_id;
      } catch {
        console.log('Error When confirming');
      }

      let tokenSymbol = pending.tokenIdentifier;
      if (pending.tokenIdentifier?.startsWith('0x')) {
        tokenSymbol = pending.tokenIdentifier;
      }

      // Execute transaction
      const transaction = await this.transactionService.privateTransact(
        pending.userId,
        telegramId,
        pending.sessionToken,
        pending.zkProof,
        pending.oldCommitments.map((commitment) => commitment.commitment),
        {
          rooiIdList: pending.oldCommitments.map(
            (commitment) => commitment.rootId,
          ),
          rootList: pending.oldCommitments.map((commitment) => commitment.root),
          nullifierHashes: pending.oldCommitments.map((commitment) =>
            Prove.shortenCommitment(commitment.nullifier),
          ),
          newCommitment1: Prove.shortenCommitment(
            pending.newCommitments.commitmentRecipient,
          ),
          newCommitment2: pending.newCommitments.commitmentChange
            ? Prove.shortenCommitment(pending.newCommitments.commitmentChange)
            : null,
          tokenOut: pending.token,
          amountOut: pending.amount,
          recipientWithdraw: pending.recipient,
        },
        {
          recipient: pending.recipient,
          token: pending.token,
          amountToSend: pending.amount,
          amountChange: pending.amountChange,
          newCommitments: pending.newCommitments,
        },
        pending.tokenIdentifier,
      );

      await this.deletePasswordMessages(ctx, telegramId);

      this.pendingOperations.delete(telegramId);

      await ctx.reply(
        `✅ Transaction sent!\n\n` +
          `Hash: \`${transaction.txHash}\`\n` +
          `Amount: ${pending.amount} ${tokenSymbol?.toUpperCase() || 'tokens'}\n` +
          `Recipient: \`${pending.recipient}\`\n\n` +
          `Status: ${transaction.status}\n\n` +
          `_Your token is unshielded._`,
        { parse_mode: 'Markdown' },
      );
      await this.telegramService.renderWalletCenter(ctx);
    } catch (error) {
      // Delete password messages on error
      await this.deletePasswordMessages(ctx, telegramId);
      this.pendingOperations.delete(telegramId);
      await ctx.reply(`❌ Transaction failed: ${error.message}`);
    } finally {
      if (chatId && verifyingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, verifyingMessageId);
        } catch {
          console.log('Error when delete in send confirming');
        }
      }
      if (chatId && sendingMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, sendingMessageId);
        } catch {
          //
        }
      }
    }
  }
}
