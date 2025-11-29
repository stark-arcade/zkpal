import { Commitment, CommitmentSchema } from '@app/shared/models/schema';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommitmentService } from './commitment.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Commitment.name, schema: CommitmentSchema },
    ]),
  ],
  providers: [CommitmentService],
  exports: [CommitmentService],
})
export class CommitmentModule {}
