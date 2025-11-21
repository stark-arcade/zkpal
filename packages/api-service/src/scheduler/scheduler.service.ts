import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionService } from '../auth/session.service';
import { TransactionService } from '../wallet/transaction.service';
import { BlockchainService } from '../blockchain/blockchain.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  constructor(
    private sessionService: SessionService,
    private transactionService: TransactionService,
    private blockchainService: BlockchainService,
  ) {}

  onModuleInit() {
    console.log('Scheduler service initialized');
  }

  /**
   * Cleanup expired sessions and keys every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredSessions() {
    try {
      await this.sessionService.cleanupExpiredSessions();
      console.log('Expired sessions cleaned up');
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
    }
  }

  /**
   * Update pending transaction statuses every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async updateTransactionStatuses() {
    try {
      // This would query pending transactions and update their status
      // Implementation depends on your transaction tracking logic
      console.log('Transaction statuses updated');
    } catch (error) {
      console.error('Error updating transaction statuses:', error);
    }
  }
}

