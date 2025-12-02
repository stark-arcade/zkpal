import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type WalletDocument = Wallet & Document;

@Schema({
  timestamps: true,
})
export class Wallet {
  @Prop({ required: true, ref: 'User', index: true })
  userId: mongoose.Types.ObjectId; // Reference to User

  @Prop({ required: true, unique: true })
  address: string; // Starknet wallet address

  @Prop({ required: true })
  encryptedPrivateKey: string; // AES-256-GCM encrypted private key

  @Prop({ required: true })
  passwordHash: string; // Bcrypt hash of user password (for verification)

  @Prop({ required: true })
  encryptionSalt: string; // Salt used for key derivation (PBKDF2)

  @Prop({ required: true })
  iv: string; // Initialization vector for AES encryption

  @Prop()
  publicKey?: string; // Public key (if needed)

  @Prop({ default: 'ztarknet' })
  network: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: false })
  isDeployed: boolean; // Whether the account has been deployed on-chain

  @Prop()
  deploymentTxHash?: string; // Transaction hash of account deployment
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
WalletSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'wallet_active_per_user',
  },
);
WalletSchema.index({ userId: 1 }, { name: 'wallet_user_lookup' });
WalletSchema.index({ address: 1 }, { unique: true });
