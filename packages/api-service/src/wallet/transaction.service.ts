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

@Injectable()
export class TransactionService {
  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
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
      tokenAddress,
      tokenSymbol,
      amount,
      recipientAddress: toAddress,
      status: 'pending',
    });

    await transaction.save();

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
    sessionToken: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    slippage: number = 0.5,
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

    // Execute swap
    let txHash: string;
    try {
      txHash = await this.blockchainService.swapTokens(
        account,
        tokenIn,
        tokenOut,
        amountIn,
        slippage,
      );
    } catch (error) {
      throw new BadRequestException(`Swap failed: ${error.message}`);
    }

    // Create transaction record
    const transaction = new this.transactionModel({
      userId,
      walletAddress,
      txHash,
      type: 'swap',
      tokenAddress: tokenIn,
      amount: amountIn,
      recipientAddress: tokenOut, // Store tokenOut in recipientAddress for swaps
      status: 'pending',
    });

    await transaction.save();

    // Update session activity
    await this.sessionService.updateActivity(sessionToken);

    return transaction;
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    userId: string,
    limit: number = 50,
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
   * Update transaction status
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
