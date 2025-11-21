import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    WalletModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}

