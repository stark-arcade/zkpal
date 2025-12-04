import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, ref: 'User' })
  userId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  walletAddress: string; // Sender wallet address

  @Prop({ required: true })
  txHash: string; // Blockchain transaction hash

  @Prop({ required: true })
  type:
    | 'send'
    | 'receive'
    | 'swap'
    | 'private_swap'
    | 'shield'
    | 'private_transact'
    | 'unshield'; // Transaction type

  @Prop({ required: true })
  tokenAddress: string; // Token contract address

  @Prop()
  tokenSymbol?: string; // Token symbol (STRK,Ztarknet,etc.)

  @Prop({ required: true })
  amount: string; // Amount (as string for precision)

  @Prop()
  recipientAddress: string | null; // Recipient address or telegramId (null for shield)

  @Prop({ default: 'pending' })
  status: 'pending' | 'confirmed' | 'failed';

  @Prop()
  tokenAddressOut?: string; // Token contract address for swap

  @Prop()
  amountOut?: string; // Amount (as string for precision) for swap

  @Prop()
  blockNumber?: number;

  @Prop()
  gasUsed?: string;

  @Prop()
  errorMessage?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ txHash: 1 }, { unique: true });
TransactionSchema.index({ walletAddress: 1 });
TransactionSchema.index({ createdAt: -1 }); // For history queries
TransactionSchema.index({ status: 1 });
