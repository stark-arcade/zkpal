import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { AuthModule } from './auth/auth.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from 'shared/config/configuration';
import { validate } from 'shared/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      validate,
      envFilePath: ['../../.env'],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('app.mongodb.uri'),
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    AuthModule,
    WalletModule,
    BlockchainModule,
    TelegramModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
