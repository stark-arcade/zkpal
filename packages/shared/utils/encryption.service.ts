import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly SALT_ROUNDS = 12;
  private readonly PBKDF2_ITERATIONS = 100000;
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly IV_LENGTH = 16; // 128 bits
  private readonly ALGORITHM = 'aes-256-gcm';

  /**
   * Hash password with bcrypt (for verification)
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify password against bcrypt hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Derive encryption key from password using PBKDF2
   */
  private deriveEncryptionKey(
    password: string,
    salt: string,
  ): Buffer {
    return crypto.pbkdf2Sync(
      password,
      salt,
      this.PBKDF2_ITERATIONS,
      this.KEY_LENGTH,
      'sha256',
    );
  }

  /**
   * Generate random salt for encryption
   */
  generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Encrypt private key using AES-256-GCM
   * Returns encrypted data, IV, and auth tag
   */
  async encryptPrivateKey(
    privateKey: string,
    password: string,
    salt: string,
  ): Promise<{ encrypted: string; iv: string }> {
    const encryptionKey = this.deriveEncryptionKey(password, salt);
    const iv = crypto.randomBytes(this.IV_LENGTH);

    const cipher = crypto.createCipheriv(this.ALGORITHM, encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(privateKey, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Combine encrypted data with auth tag
    const encryptedWithTag = Buffer.concat([encrypted, authTag]);

    return {
      encrypted: encryptedWithTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  /**
   * Decrypt private key using AES-256-GCM
   */
  async decryptPrivateKey(
    encryptedKey: string,
    password: string,
    salt: string,
    iv: string,
  ): Promise<string> {
    try {
      const encryptionKey = this.deriveEncryptionKey(password, salt);
      const ivBuffer = Buffer.from(iv, 'hex');
      const encryptedBuffer = Buffer.from(encryptedKey, 'hex');

      // Extract auth tag (last 16 bytes) and encrypted data
      const authTag = encryptedBuffer.slice(-16);
      const encrypted = encryptedBuffer.slice(0, -16);

      const decipher = crypto.createDecipheriv(
        this.ALGORITHM,
        encryptionKey,
        ivBuffer,
      );
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error('Failed to decrypt private key: Invalid password or corrupted data');
    }
  }

  /**
   * Generate random session token
   */
  generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

