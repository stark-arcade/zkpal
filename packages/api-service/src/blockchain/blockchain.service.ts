/* eslint-disable @typescript-eslint/no-explicit-any */
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
      console.log('New OZ account:\nprivateKey=', privateKey);
      const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);
      console.log('publicKey=', starkKeyPub);

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
   * Check if account address has sufficient balance for deployment
   */
  async checkAccountFunded(address: string): Promise<{
    isFunded: boolean;
    balance: string;
    requiredAmount?: string;
  }> {
    try {
      const myProvider = new RpcProvider({ nodeUrl: this.rpcUrl });

      const ztarknetAddress =
        '0x01ad102B4C4b3e40a51b6Fb8a446275D600555bd63A95CdcEeD3e5ceF8A6BC1d';

      const erc20Abi = [
        {
          name: 'balanceOf',
          type: 'function',
          inputs: [
            {
              name: 'account',
              type: 'felt',
            },
          ],
          outputs: [
            {
              name: 'balance',
              type: 'Uint256',
            },
          ],
          stateMutability: 'view',
        },
      ];

      let balance = '0';
      try {
        const ztarknetContract = new Contract({
          abi: erc20Abi,
          address: ztarknetAddress,
        });
        const balanceResult = await ztarknetContract.balanceOf(address);

        // balanceOf returns Uint256 { low, high }
        // Convert to string
        if (
          balanceResult &&
          typeof balanceResult === 'object' &&
          'low' in balanceResult
        ) {
          // Uint256 format
          const low = BigInt(balanceResult.low || 0);
          const high = BigInt(balanceResult.high || 0);
          balance = (high * BigInt(2 ** 128) + low).toString();
        } else {
          balance = balanceResult?.toString() || '0';
        }
      } catch (error) {
        // If balance query fails (contract might not exist on this network), assume 0
        console.warn(`Failed to query balance for ${address}:`, error.message);
        balance = '0';
      }

      const balanceWei = BigInt(balance);

      const requiredAmount = '1000000000000000'; // 0.001 STRK in wei (adjust as needed)
      const requiredWei = BigInt(requiredAmount);

      return {
        isFunded: balanceWei >= requiredWei,
        balance: balance.toString(),
        requiredAmount,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to check account balance: ${error.message}`,
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

      // Check if account is funded
      // const fundingStatus = await this.checkAccountFunded(address);
      // if (!fundingStatus.isFunded) {
      //   throw new BadRequestException(
      //     `Account not funded. Current balance: ${fundingStatus.balance}, Required: ${fundingStatus.requiredAmount}`,
      //   );
      // }

      const OZaccountClassHash =
        '0x01484c93b9d6cf61614d698ed069b3c6992c32549194fc3465258c2194734189';
      const OZaccountConstructorCallData = CallData.compile({
        publicKey,
      });

      const OZaccount = new Account({
        provider: myProvider,
        address,
        signer: privateKey,
      });

      console.log('Deploying account to:', address);
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
      // TODO: Replace with  balance query

      return '0';
    } catch (error) {
      throw new BadRequestException(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Send token using Account
   * Note: Replace with your actual Starknet SDK implementation
   */
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
