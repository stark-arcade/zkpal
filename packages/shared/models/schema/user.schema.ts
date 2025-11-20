import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = Users & Document;
@Schema({
  timestamps: true,
})
export class Users extends Document {
  @Prop({
    unique: true,
  })
  address: string;

  @Prop({
    required: true,
    unique: true,
  })
  username: string;

  @Prop()
  nonce: string;
}

export const UserSchema = SchemaFactory.createForClass(Users);
UserSchema.index({ player: 1 });
