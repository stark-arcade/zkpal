import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

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
  ],
})
export class AppModule {}
