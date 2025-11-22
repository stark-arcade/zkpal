import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Users, UserDocument } from 'shared/models/schema/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(Users.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Create or get user by Telegram ID
   */
  async createOrGetUser(
    telegramId: string,
    telegramUsername?: string,
    firstName?: string,
    lastName?: string,
  ): Promise<UserDocument> {
    let user = await this.userModel.findOne({ telegramId }).exec();

    if (!user) {
      user = new this.userModel({
        telegramId,
        telegramUsername,
        firstName,
        lastName,
        isWalletCreated: false,
        status: 'active',
        lastActivityAt: new Date(),
      });
      await user.save();
    } else {
      // Update user info if provided
      if (telegramUsername) user.telegramUsername = telegramUsername;
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      user.lastActivityAt = new Date();
      await user.save();
    }

    return user;
  }

  /**
   * Get user by Telegram ID
   */
  async getUserByTelegramId(telegramId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }

  async getUserById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  /**
   * Update wallet creation status
   */
  async updateWalletStatus(
    userId: string,
    isWalletCreated: boolean,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { isWalletCreated }).exec();
  }

  /**
   * Update user activity
   */
  async updateActivity(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, { lastActivityAt: new Date() })
      .exec();
  }
}
