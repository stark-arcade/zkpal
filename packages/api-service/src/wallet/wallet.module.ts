import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Wallet, WalletSchema } from 'shared/models/schema/wallet.schema';
import {
  Transaction,
  TransactionSchema,
} from 'shared/models/schema/transaction.schema';
import { WalletService } from './wallet.service';
import { TransactionService } from './transaction.service';
import { SwapService } from './swap.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { AuthModule } from '../auth/auth.module';
import { Commitment, CommitmentSchema } from '@app/shared/models/schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Commitment.name, schema: CommitmentSchema },
    ]),
    AuthModule,
  ],
  providers: [WalletService, TransactionService, SwapService, BlockchainService],
  exports: [WalletService, TransactionService, SwapService, BlockchainService],
})
export class WalletModule {}
