import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from 'shared/models/schema/session.schema';
import { EncryptionService } from 'shared/utils/encryption.service';
import { SESSION_CONFIG } from 'shared/utils/constants';

@Injectable()
export class SessionService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    private encryptionService: EncryptionService,
  ) {}

  /**
   * Create new session (when user first interacts or creates wallet)
   */
  async createSession(
    userId: string,
    telegramId: string,
    passwordHash: string,
  ): Promise<SessionDocument> {
    const sessionToken = this.encryptionService.generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + SESSION_CONFIG.EXPIRY_HOURS);

    const session = new this.sessionModel({
      userId,
      telegramId,
      sessionToken,
      passwordHash,
      isVerified: false,
      expiresAt,
      lastActivityAt: new Date(),
    });

    return session.save();
  }

  /**
   * Get session by token
   */
  async getSession(sessionToken: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ sessionToken }).exec();
  }

  /**
   * Get session by telegram ID
   */
  async getSessionByTelegramId(telegramId: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ telegramId }).exec();
  }

  /**
   * Verify password and unlock wallet (decrypt private key)
   */
  async unlockWallet(
    sessionToken: string,
    password: string,
    encryptedPrivateKey: string,
    encryptionSalt: string,
    iv: string,
    walletAddress: string,
  ): Promise<SessionDocument> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    // Check if session is locked
    if (session.isLocked || (session.lockedUntil && session.lockedUntil > new Date())) {
      throw new UnauthorizedException('Account is locked. Please try again later.');
    }

    // Check if session is expired
    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired. Please create a new session.');
    }

    // Verify password
    const isValidPassword = await this.encryptionService.verifyPassword(
      password,
      session.passwordHash,
    );

    if (!isValidPassword) {
      // Increment failed attempts
      session.failedAttempts += 1;

      // Lock account if max attempts reached
      if (session.failedAttempts >= SESSION_CONFIG.MAX_FAILED_ATTEMPTS) {
        session.isLocked = true;
        session.lockedUntil = new Date();
        session.lockedUntil.setMinutes(
          session.lockedUntil.getMinutes() + SESSION_CONFIG.LOCKOUT_DURATION_MINUTES,
        );
        await session.save();
        throw new UnauthorizedException(
          `Too many failed attempts. Account locked for ${SESSION_CONFIG.LOCKOUT_DURATION_MINUTES} minutes.`,
        );
      }

      await session.save();
      throw new UnauthorizedException(
        `Invalid password. ${SESSION_CONFIG.MAX_FAILED_ATTEMPTS - session.failedAttempts} attempts remaining.`,
      );
    }

    // Reset failed attempts on successful verification
    session.failedAttempts = 0;
    session.isVerified = true;
    session.lastVerifiedAt = new Date();

    // Decrypt private key
    const decryptedPrivateKey = await this.encryptionService.decryptPrivateKey(
      encryptedPrivateKey,
      password,
      encryptionSalt,
      iv,
    );

    // Set unlock expiration
    const keyExpiresAt = new Date();
    keyExpiresAt.setMinutes(keyExpiresAt.getMinutes() + SESSION_CONFIG.KEY_UNLOCK_MINUTES);

    // Store decrypted key temporarily
    session.decryptedPrivateKey = decryptedPrivateKey;
    session.walletAddress = walletAddress;
    session.keyUnlockedAt = new Date();
    session.keyExpiresAt = keyExpiresAt;
    session.lastActivityAt = new Date();

    return session.save();
  }

  /**
   * Get decrypted private key (if unlocked and not expired)
   */
  async getDecryptedPrivateKey(sessionToken: string): Promise<string> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (!session.isWalletUnlocked()) {
      throw new UnauthorizedException('Wallet is not unlocked. Please unlock it first.');
    }

    // Update last activity
    session.lastActivityAt = new Date();
    await session.save();

    return session.decryptedPrivateKey!;
  }

  /**
   * Check if wallet is currently unlocked
   */
  async isWalletUnlocked(sessionToken: string): Promise<boolean> {
    const session = await this.getSession(sessionToken);
    if (!session) return false;
    return session.isWalletUnlocked();
  }

  /**
   * Lock wallet (clear decrypted key, keep session)
   */
  async lockWallet(sessionToken: string): Promise<void> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    session.decryptedPrivateKey = undefined;
    session.keyUnlockedAt = undefined;
    session.keyExpiresAt = undefined;
    session.lastActivityAt = new Date();

    await session.save();
  }

  /**
   * Extend key unlock duration
   */
  async extendKeyUnlock(sessionToken: string, minutes: number = SESSION_CONFIG.KEY_UNLOCK_MINUTES): Promise<void> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (!session.decryptedPrivateKey) {
      throw new BadRequestException('Wallet is not unlocked');
    }

    const keyExpiresAt = new Date();
    keyExpiresAt.setMinutes(keyExpiresAt.getMinutes() + minutes);
    session.keyExpiresAt = keyExpiresAt;
    session.lastActivityAt = new Date();

    await session.save();
  }

  /**
   * Verify password (without unlocking)
   */
  async verifyPassword(sessionToken: string, password: string): Promise<boolean> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    return this.encryptionService.verifyPassword(password, session.passwordHash);
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(sessionToken: string): Promise<void> {
    const session = await this.getSession(sessionToken);
    if (session) {
      session.lastActivityAt = new Date();
      await session.save();
    }
  }

  /**
   * Refresh password hash for all sessions owned by a user
   */
  async updatePasswordHashForUser(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.sessionModel
      .updateMany(
        { userId },
        {
          $set: {
            passwordHash,
            isVerified: false,
            failedAttempts: 0,
            lastActivityAt: new Date(),
          },
          $unset: {
            decryptedPrivateKey: '',
            keyUnlockedAt: '',
            keyExpiresAt: '',
          },
        },
      )
      .exec();
  }

  /**
   * Invalidate entire session
   */
  async invalidateSession(sessionToken: string): Promise<void> {
    await this.sessionModel.deleteOne({ sessionToken }).exec();
  }

  /**
   * Cleanup expired sessions and keys
   */
  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();

    // Clear expired keys (but keep session)
    await this.sessionModel.updateMany(
      {
        keyExpiresAt: { $lt: now },
      },
      {
        $unset: {
          decryptedPrivateKey: '',
          keyUnlockedAt: '',
          keyExpiresAt: '',
        },
      },
    ).exec();

    // Delete expired sessions (optional - or keep for history)
    await this.sessionModel.deleteMany({
      expiresAt: { $lt: now },
    }).exec();
  }

  /**
   * Lock session (security)
   */
  async lockSession(sessionToken: string): Promise<void> {
    const session = await this.getSession(sessionToken);
    if (session) {
      session.isLocked = true;
      session.decryptedPrivateKey = undefined;
      session.keyUnlockedAt = undefined;
      session.keyExpiresAt = undefined;
      await session.save();
    }
  }
}

