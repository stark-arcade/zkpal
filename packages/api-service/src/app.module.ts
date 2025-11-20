import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import configuration from 'shared/config/configuration';
import { validate } from 'shared/config/env.validation';

@Module({
  imports: [
    TelegramModule,
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      validate,
      envFilePath: ['../../.env'],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
