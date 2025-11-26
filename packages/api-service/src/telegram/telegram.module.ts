import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { TelegramService } from './telegram.service';
import { TelegrafModule } from 'nestjs-telegraf';
import { WalletHandler } from './handlers/wallet.handler';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { UIBuilderService } from './ui-builder.service';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.getOrThrow<string>('app.telegram.botToken'),
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    WalletModule,
    AuthModule,
  ],
  controllers: [],
  providers: [TelegramService, WalletHandler, UIBuilderService],
})
export class TelegramModule {}
