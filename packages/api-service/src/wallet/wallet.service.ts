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
import { TOKENS } from 'shared/ztarknet/tokens';

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
    options: { allowReplace?: boolean } = {},
  ): Promise<{ wallet: WalletDocument; address: string; privateKey: string }> {
    let deactivatedWallet: WalletDocument | null = null;
    const existingWallet = await this.walletModel
      .findOne({ userId, isActive: true })
      .exec();

    if (existingWallet) {
      if (!options.allowReplace) {
        throw new BadRequestException('Wallet already exists for this user');
      }

      existingWallet.isActive = false;
      await existingWallet.save();
      deactivatedWallet = existingWallet;
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

    try {
      await wallet.save();
      return { wallet, address, privateKey };
    } catch (error) {
      if (deactivatedWallet) {
        deactivatedWallet.isActive = true;
        await deactivatedWallet.save();
      }
      throw error;
    }
  }

  async verifyPrivateKeyOwnership(
    userId: string,
    privateKey: string,
  ): Promise<{
    wallet: WalletDocument;
    normalizedPrivateKey: string;
    publicKey: string;
  }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet || !wallet.isActive) {
      throw new NotFoundException('Active wallet not found for this user');
    }

    const derived = await this.blockchainService.deriveWalletFromPrivateKey(
      privateKey,
    );

    if (derived.address.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new BadRequestException(
        'Private key does not match the active wallet',
      );
    }

    return {
      wallet,
      normalizedPrivateKey: derived.normalizedPrivateKey,
      publicKey: derived.publicKey,
    };
  }

  async resetWalletPasswordWithPrivateKey(
    userId: string,
    privateKey: string,
    newPassword: string,
  ): Promise<WalletDocument> {
    const { wallet, normalizedPrivateKey, publicKey } =
      await this.verifyPrivateKeyOwnership(userId, privateKey);

    const passwordHash = await this.encryptionService.hashPassword(newPassword);
    const encryptionSalt = this.encryptionService.generateSalt();
    const { encrypted, iv } = await this.encryptionService.encryptPrivateKey(
      normalizedPrivateKey,
      newPassword,
      encryptionSalt,
    );

    wallet.passwordHash = passwordHash;
    wallet.encryptionSalt = encryptionSalt;
    wallet.iv = iv;
    wallet.encryptedPrivateKey = encrypted;
    wallet.publicKey = publicKey;

    return wallet.save();
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
    return this.walletModel.findOne({ userId, isActive: true }).exec();
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

  /**
   * Find token address from identifier (symbol or contract address)
   * @param identifier - Token symbol (e.g., "strk") or contract address (e.g., "0x...")
   * @returns Token address if found, null otherwise
   */
  findTokenAddress(identifier: string): string | null {
    if (!identifier) {
      return null;
    }

    // Normalize identifier (lowercase, trim)
    const normalized = identifier.toLowerCase().trim();

    // If it's already a valid address (starts with 0x), return it directly
    if (normalized.startsWith('0x') && normalized.length >= 3) {
      return normalized as `0x${string}`;
    }

    // Search for token by symbol (case-insensitive)
    for (const token of Object.values(TOKENS)) {
      if (token.attributes.symbol.toLowerCase() === normalized) {
        return token.attributes.address;
      }
    }

    // Token not found
    return null;
  }
}
