import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CommitmentDocument = Commitment & Document;

@Schema({ timestamps: true })
export class Commitment {
  @Prop()
  owner: string; // Could be telegramId or starknet address

  @Prop({ required: true })
  commitment: string;

  @Prop({ required: true })
  secret: string;

  @Prop({ required: true })
  nullifier: string;

  @Prop({ required: true })
  note: string;

  @Prop({ required: true })
  noteIndex: number;

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true })
  token: string;

  @Prop()
  tokenSymbol?: string;

  @Prop({ required: true })
  root: string;

  @Prop({ required: true })
  rootId: string;

  @Prop({ required: true })
  isSpent: boolean;
}

export const CommitmentSchema = SchemaFactory.createForClass(Commitment);
CommitmentSchema.index({ owner: 1 });
CommitmentSchema.index({ token: 1 });
CommitmentSchema.index({ commitment: 1 }, { unique: true });
CommitmentSchema.index({ nullifier: 1 });
CommitmentSchema.index({ noteIndex: 1 });
