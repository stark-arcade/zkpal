/* eslint-disable @typescript-eslint/no-explicit-any */
import { erc20Abi } from '@app/shared/ztarknet/abi/erc20ABI';
import { CONTRACT_ADDRESS } from '@app/shared/ztarknet/constants';
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  ec,
  stark,
  RpcProvider,
  hash,
  CallData,
  Contract,
} from 'starknet';

@Injectable()
export class BlockchainService {
  private readonly rpcUrl: string;

  constructor(private configService: ConfigService) {
    this.rpcUrl = this.configService.getOrThrow<string>('app.rpc_url');
  }

  /**
   * Generate wallet address and keys (without deploying)
   * User needs to fund the address before deployment
   */
  async generateWalletAddress(): Promise<{
    address: string;
    privateKey: string;
    publicKey: string;
  }> {
    try {
      // Generate public and private key pair.
      const privateKey = stark.randomAddress();
      const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);

      const OZaccountClassHash =
        '0x01484c93b9d6cf61614d698ed069b3c6992c32549194fc3465258c2194734189';
      // Calculate future address of the account
      const OZaccountConstructorCallData = CallData.compile({
        publicKey: starkKeyPub,
      });
      const OZcontractAddress = hash.calculateContractAddressFromHash(
        starkKeyPub,
        OZaccountClassHash,
        OZaccountConstructorCallData,
        0,
      );

      return {
        address: OZcontractAddress,
        privateKey,
        publicKey: starkKeyPub,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate wallet address: ${error.message}`,
      );
    }
  }

  /**
   * Deploy account after it has been funded
   */
  async deployAccount(
    address: string,
    privateKey: string,
    publicKey: string,
  ): Promise<{
    transactionHash: string;
    contractAddress: string;
  }> {
    try {
      const myProvider = new RpcProvider({ nodeUrl: this.rpcUrl });

      const balance = await this.getBalance(address);

      const OZaccountClassHash = CONTRACT_ADDRESS.OZACCOUNT_CLASS_HASH;
      const OZaccountConstructorCallData = CallData.compile({
        publicKey,
      });
      const OZaccount = new Account({
        provider: myProvider,
        address,
        signer: privateKey,
      });

      const fee = await OZaccount.estimateAccountDeployFee({
        classHash: OZaccountClassHash,
        constructorCalldata: OZaccountConstructorCallData,
        contractAddress: OZaccount.address,
      });

      const estimatedFee = fee.overall_fee;
      const safetyMargin = 1.2; // 20% safety margin
      const requiredBalance = BigInt(
        Math.floor(Number(estimatedFee) * safetyMargin),
      );
      const requireBalanceInWei = (Number(requiredBalance) / 1e18).toFixed(10);
      if (Number(requireBalanceInWei) > Number(balance)) {
        throw new BadRequestException(
          `Account not funded. Current balance: ${balance}, Required: ${requireBalanceInWei} STRK`,
        );
      }

      const { transaction_hash, contract_address } =
        await OZaccount.deployAccount({
          classHash: OZaccountClassHash,
          constructorCalldata: OZaccountConstructorCallData,
          addressSalt: publicKey,
        });

      await myProvider.waitForTransaction(transaction_hash);
      console.log(
        '✅ Account deployed successfully.\n   address =',
        contract_address,
        '\n   txHash =',
        transaction_hash,
      );

      return {
        transactionHash: transaction_hash,
        contractAddress: contract_address,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to deploy account: ${error.message}`,
      );
    }
  }

  /**
   * Create Account instance from private key (for transactions)
   * Note: Replace with your actual Starknet SDK implementation
   */
  async createAccountFromPrivateKey(
    privateKey: string,
    address: string,
  ): Promise<any> {
    try {
      // TODO : Replace  Account creation logic -> Wallet client
      return {
        address,
        privateKey,
        provider: { nodeUrl: this.rpcUrl },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to create account: ${error.message}`,
      );
    }
  }

  /**
   * Get balance using Account
   * Note: Replace with your actual Starknet SDK implementation
   */
  async getBalance(address: string, tokenAddress?: string): Promise<string> {
    try {
      const myProvider = new RpcProvider({ nodeUrl: this.rpcUrl });

      const ztarknetContract = new Contract({
        abi: erc20Abi,
        address: tokenAddress || CONTRACT_ADDRESS.ZTARKNET_TOKEN,
        providerOrAccount: myProvider,
      });
      const balanceResult = await ztarknetContract.balanceOf(address);
      console.log('Balance', balanceResult);
      const formattedBalance = Number(balanceResult.balance) / 1e18;
      return formattedBalance.toString();
    } catch (error) {
      throw new BadRequestException(`Failed to get balance: ${error.message}`);
    }
  }

  async sendToken(
    account: any,
    toAddress: string,
    amount: string,
    tokenAddress: string,
  ): Promise<string> {
    try {
      const txHash = '0x' + ``;
      return txHash;
    } catch (error) {
      throw new BadRequestException(`Failed to send token: ${error.message}`);
    }
  }

  /**
   * Swap tokens (if implementing DEX integration)
   * Note: Replace with your actual DEX integration
   */
  async swapTokens(
    account: any,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    slippage: number = 0.5,
  ): Promise<string> {
    try {
      // TODO: Implement DEX swap logic

      const txHash = '0x';
      return txHash;
    } catch (error) {
      throw new BadRequestException(`Failed to swap tokens: ${error.message}`);
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    blockNumber?: number;
    gasUsed?: string;
  }> {
    try {
      // TODO: Replace with  transaction status query

      // Placeholder
      return {
        status: 'pending' as const,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get transaction status: ${error.message}`,
      );
    }
  }
}
