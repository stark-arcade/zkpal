import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = Users & Document;
@Schema({
  timestamps: true,
})
export class Users extends Document {
  @Prop({ required: true, unique: true })
  telegramId: string;

  @Prop()
  telegramUsername?: string;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop({ default: false })
  isWalletCreated: boolean;

  @Prop({ default: 'pending' })
  status: 'pending' | 'active' | 'suspended';

  @Prop()
  lastActivityAt?: Date; // Last time session was used
}

export const UserSchema = SchemaFactory.createForClass(Users);
UserSchema.index({ telegramId: 1 });
UserSchema.index({ isWalletCreated: 1 });
