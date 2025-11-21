import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Session, SessionSchema } from 'shared/models/schema/session.schema';
import { SessionService } from './session.service';
import { EncryptionService } from 'shared/utils/encryption.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
  ],
  providers: [SessionService, EncryptionService],
  exports: [SessionService, EncryptionService],
})
export class AuthModule {}

