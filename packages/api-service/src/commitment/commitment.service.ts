import { Commitment, CommitmentDocument } from '@app/shared/models/schema';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { formatUnits, parseUnits } from 'ethers';
import { Model } from 'mongoose';

@Injectable()
export class CommitmentService {
  constructor(
    @InjectModel(Commitment.name)
    private commitmentModel: Model<CommitmentDocument>,
  ) {}

  async getLatestNote(owner: string): Promise<number> {
    const latestCommitment = await this.commitmentModel
      .findOne({ owner })
      .sort({ noteIndex: -1 });

    return latestCommitment ? latestCommitment.noteIndex : 0;
  }

  async getPrivateBalanceList(
    owner: string,
  ): Promise<{ token: string; amount: string }[]> {
    const privateBalances = await this.commitmentModel.find({
      owner,
      isSpent: false,
    });
    const balances = new Map<string, string>();
    for (const commitment of privateBalances) {
      const key = commitment.tokenSymbol || commitment.token.toLowerCase();
      const total = balances.get(key) || '0';
      balances.set(
        key,
        formatUnits(
          parseUnits(total, 18) + parseUnits(commitment.amount, 18),
          18,
        ),
      );
    }

    return Array.from(balances.entries()).map(([token, amount]) => ({
      token,
      amount,
    }));
  }

  async getPrivateBalance(owner: string, token: string): Promise<string> {
    const privateBalances = await this.commitmentModel.find({
      owner,
      token: token.toLowerCase(),
      isSpent: false,
    });

    let totalBalance = 0n;
    for (const commitment of privateBalances) {
      totalBalance += parseUnits(commitment.amount, 18);
    }

    return formatUnits(totalBalance, 18);
  }

  async getCommitmentsForTransact(
    owner: string,
    token: string,
    totalAmountToSend: bigint,
  ): Promise<CommitmentDocument[]> {
    const commitments = await this.commitmentModel.find(
      {
        owner,
        token: token.toLowerCase(),
        isSpent: false,
      },
      {},
      { sort: { noteIndex: 1 } },
    );

    const filteredCommitments = [];
    let totalBalance = 0n;

    for (const commitment of commitments) {
      const amount = parseUnits(commitment.amount, 18);
      filteredCommitments.push(commitment);
      totalBalance += amount;
      if (totalBalance > totalAmountToSend) {
        break;
      }
    }

    if (totalBalance < totalAmountToSend) {
      throw new Error(`Not enough commiment. You only have ${totalBalance}`);
    }

    return filteredCommitments;
  }
}
