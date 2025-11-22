import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Wallet, WalletDocument } from 'shared/models/schema/wallet.schema';
import { EncryptionService } from 'shared/utils/encryption.service';
import { BlockchainService } from '../blockchain/blockchain.service';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    private encryptionService: EncryptionService,
    private blockchainService: BlockchainService,
  ) {}

  /**
   * Create wallet address and keys (without deploying)
   * User needs to fund the address before deployment
   */
  async createWalletAddress(
    userId: string,
    password: string,
  ): Promise<{ wallet: WalletDocument; address: string; privateKey: string }> {
    // Check if wallet already exists
    const existingWallet = await this.walletModel.findOne({ userId }).exec();
    if (existingWallet) {
      throw new BadRequestException('Wallet already exists for this user');
    }

    // Generate wallet address and keys (without deploying)
    const { address, privateKey, publicKey } =
      await this.blockchainService.generateWalletAddress();

    // Hash password with bcrypt
    const passwordHash = await this.encryptionService.hashPassword(password);

    // Generate encryption salt
    const encryptionSalt = this.encryptionService.generateSalt();

    // Encrypt private key
    const { encrypted, iv } = await this.encryptionService.encryptPrivateKey(
      privateKey,
      password,
      encryptionSalt,
    );

    // Create wallet document (not deployed yet)
    const wallet = new this.walletModel({
      userId,
      address,
      encryptedPrivateKey: encrypted,
      passwordHash,
      encryptionSalt,
      iv,
      publicKey,
      network: 'ztarknet',
      isActive: true,
      isDeployed: false,
    });

    await wallet.save();

    return { wallet, address, privateKey };
  }

  /**
   * Deploy wallet account after funding
   */
  async deployWallet(
    userId: string,
    password: string,
  ): Promise<{ transactionHash: string; contractAddress: string }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    if (wallet.isDeployed) {
      throw new BadRequestException('Wallet is already deployed');
    }

    // Decrypt private key
    const privateKey = await this.encryptionService.decryptPrivateKey(
      wallet.encryptedPrivateKey,
      password,
      wallet.encryptionSalt,
      wallet.iv,
    );

    // Deploy account
    const { transactionHash, contractAddress } =
      await this.blockchainService.deployAccount(
        wallet.address,
        privateKey,
        wallet.publicKey!,
      );

    // Update wallet
    wallet.isDeployed = true;
    wallet.deploymentTxHash = transactionHash;
    await wallet.save();

    return { transactionHash, contractAddress };
  }

  /**
   * Get wallet by user ID
   */
  async getWalletByUserId(userId: string): Promise<WalletDocument | null> {
    return this.walletModel.findOne({ userId }).exec();
  }

  /**
   * Get wallet by address
   */
  async getWalletByAddress(address: string): Promise<WalletDocument | null> {
    return this.walletModel.findOne({ address }).exec();
  }

  /**
   * Get wallet balance
   */
  async getBalance(address: string, tokenAddress?: string): Promise<string> {
    try {
      return await this.blockchainService.getBalance(address, tokenAddress);
    } catch (error) {
      throw new BadRequestException(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Verify wallet exists for user
   */
  async verifyWalletExists(userId: string): Promise<boolean> {
    const wallet = await this.getWalletByUserId(userId);
    return !!wallet;
  }

  /**
   * Get wallet address for user
   */
  async getWalletAddress(userId: string): Promise<string> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet.address;
  }
}
