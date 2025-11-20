import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

import { TelegrafModule } from 'nestjs-telegraf';
@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.getOrThrow<string>('app.telegram.botToken'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
