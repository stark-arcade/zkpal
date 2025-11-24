import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export interface SessionDocument extends Session, Document {
  isWalletUnlocked(): boolean;
  isValid(): boolean;
  isKeyUnlockExpired(): boolean;
}

@Schema({
  timestamps: true,
})
export class Session {
  @Prop({ required: true, ref: 'User' })
  userId: mongoose.Types.ObjectId;

  @Prop({ required: true })
  telegramId: string;

  @Prop({ required: true, unique: true })
  sessionToken: string; // Unique session identifier

  @Prop({ required: true })
  passwordHash: string; // Bcrypt hash (for password verification)

  @Prop({ default: false })
  isVerified: boolean; // Whether password was verified

  @Prop()
  lastVerifiedAt?: Date; // Last password verification time

  @Prop({ default: 0 })
  failedAttempts: number; // Failed password attempts

  @Prop()
  lockedUntil?: Date; // Account lockout until this time

  @Prop()
  decryptedPrivateKey?: string; // Will Replicate By Different Method -> Redis Encrypted Storage

  @Prop()
  walletAddress?: string; // Associated wallet address

  @Prop()
  keyUnlockedAt?: Date; // When the private key was decrypted/unlocked

  @Prop()
  keyExpiresAt?: Date; // When the decrypted key expires (e.g., 30 minutes from unlock)

  // Session expiration
  @Prop({ required: true })
  expiresAt: Date; // Overall session expiration (e.g., 24 hours)

  @Prop()
  lastActivityAt?: Date; // Last time session was used

  @Prop({ default: false })
  isLocked: boolean; // Lock session if suspicious activity
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ sessionToken: 1 }, { unique: true });
SessionSchema.index({ userId: 1 });
SessionSchema.index({ telegramId: 1 });
SessionSchema.index({ expiresAt: 1 }); // For cleanup
SessionSchema.index({ keyExpiresAt: 1 }); // For key expiration cleanup
SessionSchema.index({ lastActivityAt: 1 });

// Helper methods
SessionSchema.methods.isWalletUnlocked = function (): boolean {
  return !!(
    this.decryptedPrivateKey &&
    this.keyExpiresAt &&
    this.keyExpiresAt > new Date()
  );
};

SessionSchema.methods.isValid = function (): boolean {
  return this.expiresAt > new Date() && !this.isLocked;
};

SessionSchema.methods.isKeyUnlockExpired = function (): boolean {
  if (!this.keyExpiresAt) return true;
  return this.keyExpiresAt <= new Date();
};
