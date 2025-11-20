import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlayersDocument = Players & Document;
@Schema({
  timestamps: true,
})
export class Players extends Document {
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

  @Prop({ default: { isFirstTime: true }, type: Object })
  progressData: {
    isFirstTime: boolean;
  };

  @Prop({ default: 0 })
  goldClaimed?: number;
}

export const PlayerSchema = SchemaFactory.createForClass(Players);
PlayerSchema.index({ player: 1 });
