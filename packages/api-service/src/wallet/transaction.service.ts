import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
} from 'shared/models/schema/transaction.schema';
import { SessionService } from '../auth/session.service';
import { WalletService } from './wallet.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { Commitment, CommitmentDocument } from '@app/shared/models/schema';
import {
  Field,
  TPublicInputTransact,
  TTransactCommitment,
} from '@app/shared/ztarknet/type';
import configuration from '@app/shared/config/configuration';
import { formatUnits } from 'ethers';

@Injectable()
export class TransactionService {
  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(Commitment.name)
    private commitmentModel: Model<CommitmentDocument>,
    private sessionService: SessionService,
    private walletService: WalletService,
    private blockchainService: BlockchainService,
  ) {}

  /**
   * Execute send transaction
   */
  async sendToken(
    userId: string,
    sessionToken: string,
    toAddress: string,
    amount: string,
    tokenAddress: string,
    tokenSymbol?: string,
  ): Promise<TransactionDocument> {
    // Get session and verify wallet is unlocked
    const isUnlocked = await this.sessionService.isWalletUnlocked(sessionToken);
    if (!isUnlocked) {
      throw new UnauthorizedException(
        'Wallet is not unlocked. Please unlock it first.',
      );
    }

    // Get decrypted private key
    const privateKey =
      await this.sessionService.getDecryptedPrivateKey(sessionToken);

    // Get wallet address
    const walletAddress = await this.walletService.getWalletAddress(userId);

    // Create account instance
    const account = await this.blockchainService.createAccountFromPrivateKey(
      privateKey,
      walletAddress,
    );

    // Execute transaction
    let txHash: string;
    try {
      txHash = await this.blockchainService.sendToken(
        account,
        toAddress,
        amount,
        tokenAddress,
      );
    } catch (error) {
      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }

    // Create transaction record
    const transaction = new this.transactionModel({
      userId,
      walletAddress,
      txHash,
      type: 'send',
      tokenAddress: tokenAddress.toLowerCase(),
      tokenSymbol,
      amount,
      recipientAddress: toAddress,
      // status: 'pending',
      status: 'confirmed', // !TODO Will Build A cron job to checking fail or pending confirm -> Next
    });

    await transaction.save();

    await this.sessionService.updateActivity(sessionToken);

    return transaction;
  }

  async privateTransact(
    userId: string,
    telegramId: string,
    sessionToken: string,
    zkp: bigint[],
    oldCommitmentHashes: string[],
    publicInput: TPublicInputTransact,
    secretInput: {
      recipient: string; // telegramId of recipient
      token: string;
      amountToSend: string;
      amountChange: string;
      newCommitments: TTransactCommitment;
    },
    tokenSymbol?: string,
    isRelayer: boolean = false,
  ) {
    // Get session and verify wallet is unlocked
    const isUnlocked = await this.sessionService.isWalletUnlocked(sessionToken);
    if (!isUnlocked) {
      throw new UnauthorizedException(
        'Wallet is not unlocked. Please unlock it first.',
      );
    }

    // Get wallet address
    const walletAddress = await this.walletService.getWalletAddress(userId);

    let account;
    if (!isRelayer) {
      // Get decrypted private key
      const privateKey =
        await this.sessionService.getDecryptedPrivateKey(sessionToken);

      // Create account instance
      account = await this.blockchainService.createAccountFromPrivateKey(
        privateKey,
        walletAddress,
      );
    } else {
      account = await this.blockchainService.createAccountFromPrivateKey(
        configuration().relayer.PRIVATE_KEY,
        configuration().relayer.ADDRESS,
      );
    }

    // Execute transaction
    let txReciept: {
      txHash: string;
      rootRecipient: string;
      rootRecipientId: string;
      rootChange: string | undefined;
      rootChangeId: string | undefined;
    };
    try {
      txReciept = await this.blockchainService.privateTransact(
        account,
        zkp,
        publicInput,
        isRelayer,
      );
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }

    // Create transaction record
    const transaction = new this.transactionModel({
      userId,
      walletAddress,
      txHash: txReciept.txHash,
      type:
        publicInput.amountOut === '0'
          ? 'private_transact'
          : isRelayer
            ? 'relayer_unshield'
            : 'unshield',
      tokenAddress: secretInput.token.toLowerCase(),
      tokenSymbol,
      amount: secretInput.amountToSend,
      recipientAddress: secretInput.recipient.toLowerCase(),
      status: 'confirmed',
    });
    await transaction.save();

    // Mark old commitment as spent
    await this.commitmentModel.updateMany(
      {
        commitment: { $in: oldCommitmentHashes },
      },
      { $set: { isSpent: true } },
    );

    // Create new commitment for recipient if transact mode is not unshield
    if (publicInput.amountOut === '0') {
      const newRecCommitment = new this.commitmentModel({
        owner: secretInput.recipient,
        commitment: secretInput.newCommitments.commitmentRecipient,
        secret: secretInput.newCommitments.secretRecipient,
        nullifier: secretInput.newCommitments.nullifierRecipient,
        note: secretInput.newCommitments.noteRecipient,
        noteIndex: secretInput.newCommitments.recipientNoteIndex,
        amount: secretInput.amountToSend,
        token: secretInput.token.toLowerCase(),
        tokenSymbol,
        root: txReciept.rootRecipient,
        rootId: txReciept.rootRecipientId,
        isSpent: false,
      });
      await newRecCommitment.save();
    }

    // Create new commitment for change if exists
    if (secretInput.newCommitments.commitmentChange) {
      const newChangeCommitment = new this.commitmentModel({
        owner: telegramId,
        commitment: secretInput.newCommitments.commitmentChange,
        secret: secretInput.newCommitments.secretChange,
        nullifier: secretInput.newCommitments.nullifierChange,
        note: secretInput.newCommitments.noteChange,
        noteIndex: secretInput.newCommitments.senderNoteIndex,
        amount: secretInput.amountChange,
        token: secretInput.token.toLowerCase(),
        tokenSymbol,
        root: txReciept.rootChange,
        rootId: txReciept.rootChangeId,
        isSpent: false,
      });
      await newChangeCommitment.save();
    }

    // // Update session activity
    // await this.sessionService.updateActivity(sessionToken);

    return transaction;
  }

  /**
   * Execute shield transaction
   */
  async shieldToken(
    userId: string,
    telegramId: string,
    sessionToken: string,
    amount: string,
    tokenAddress: string,
    input: {
      commitment: Field;
      secret: string;
      nullifier: Field;
      note: string;
      noteIndex: number;
    },
    tokenSymbol?: string,
    isRelayer: boolean = false,
  ): Promise<TransactionDocument> {
    // Get session and verify wallet is unlocked
    if (!isRelayer) {
      const isUnlocked =
        await this.sessionService.isWalletUnlocked(sessionToken);
      if (!isUnlocked) {
        throw new UnauthorizedException(
          'Wallet is not unlocked. Please unlock it first.',
        );
      }
    }
    // Get wallet address
    const walletAddress = await this.walletService.getWalletAddress(userId);
    let account;
    if (!isRelayer) {
      const privateKey =
        await this.sessionService.getDecryptedPrivateKey(sessionToken);

      // Create account instance
      account = await this.blockchainService.createAccountFromPrivateKey(
        privateKey,
        walletAddress,
      );
    } else {
      account = await this.blockchainService.createAccountFromPrivateKey(
        configuration().relayer.PRIVATE_KEY,
        configuration().relayer.ADDRESS,
      );
    }

    // Get decrypted private key

    let txReciept: { txHash: string; root: string; rootId: string };
    try {
      txReciept = await this.blockchainService.shieldToken(
        account,
        tokenAddress,
        amount,
        input.commitment,
        isRelayer,
      );
    } catch (error) {
      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }

    // Create transaction record
    const transaction = new this.transactionModel({
      userId,
      walletAddress,
      txHash: txReciept.txHash,
      type: 'shield',
      tokenAddress: tokenAddress.toLowerCase(),
      tokenSymbol,
      amount,
      recipientAddress: null,
      status: 'confirmed',
    });

    await transaction.save();

    // Create commitment
    const newCommitment = new this.commitmentModel({
      owner: telegramId,
      commitment: input.commitment,
      secret: input.secret,
      nullifier: input.nullifier,
      note: input.note,
      noteIndex: input.noteIndex,
      amount,
      token: tokenAddress.toLowerCase(),
      tokenSymbol,
      root: txReciept.root,
      rootId: txReciept.rootId,
      isSpent: false,
    });

    await newCommitment.save();

    // Update session activity
    await this.sessionService.updateActivity(sessionToken);

    // Optionally lock wallet after transaction (more secure)
    // await this.sessionService.lockWallet(sessionToken);

    return transaction;
  }

  /**
   * Execute swap transaction
   */
  async swapTokens(
    userId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    mintAmountOut: string = '0',
    slippage: number = 0.5,
  ): Promise<{ txHash: string; amoutOut: string }> {
    // Create account instance
    const account = await this.blockchainService.createAccountFromPrivateKey(
      configuration().relayer.PRIVATE_KEY,
      configuration().relayer.ADDRESS,
    );

    // Execute swap
    let txReceipt: { txHash: string; amoutOut: bigint };
    try {
      txReceipt = await this.blockchainService.privateSwapTokens(
        account,
        tokenIn,
        tokenOut,
        amountIn,
        mintAmountOut,
        slippage,
      );
    } catch (error) {
      throw new BadRequestException(`Swap failed: ${error.message}`);
    }

    const walletAddress = await this.walletService.getWalletAddress(userId);

    // Create transaction record
    const transaction = new this.transactionModel({
      userId,
      walletAddress,
      txHash: txReceipt.txHash,
      type: 'private_swap',
      tokenAddress: tokenIn,
      amount: amountIn,
      recipientAddress: tokenOut,
      tokenAddressOut: tokenOut,
      amountOut: formatUnits(txReceipt.amoutOut, 18),
      status: 'confirmed',
    });

    await transaction.save();

    // Update session activity
    return {
      txHash: transaction.txHash,
      amoutOut: formatUnits(txReceipt.amoutOut, 18),
    };
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    userId: string,
    limit: number = 5,
    offset: number = 0,
  ): Promise<TransactionDocument[]> {
    return this.transactionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .exec();
  }

  /**
   * Get transaction by hash
   */
  async getTransactionByHash(
    txHash: string,
  ): Promise<TransactionDocument | null> {
    return this.transactionModel.findOne({ txHash }).exec();
  }

  /**
   * Update transaction status //!TODO Use for build cronjob the next build
   */
  async updateTransactionStatus(
    txHash: string,
    status: 'pending' | 'confirmed' | 'failed',
    blockNumber?: number,
    gasUsed?: string,
    errorMessage?: string,
  ): Promise<TransactionDocument | null> {
    return this.transactionModel
      .findOneAndUpdate(
        { txHash },
        {
          status,
          blockNumber,
          gasUsed,
          errorMessage,
        },
        { new: true },
      )
      .exec();
  }
}
