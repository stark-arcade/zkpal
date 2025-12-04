import { Injectable } from '@nestjs/common';
import { TOKENS } from '@app/shared/ztarknet/tokens';
import { BlockchainService } from '../blockchain/blockchain.service';
import { formatUnits, parseUnits } from 'ethers';
import { CONTRACT_ADDRESS } from '@app/shared/ztarknet/constants';

@Injectable()
export class SwapService {
  constructor(private blockchainService: BlockchainService) {}

  async getMockPrice(tokenAddress: string): Promise<number> {
    const mockPrices: Record<string, number> = {
      // STRK (native token)
      '0x01ad102b4c4b3e40a51b6fb8a446275d600555bd63a95cdceed3e5cef8a6bc1d': 50.0,
      // Test tokens
      '0x3adfa5dfa8350ea015fe370434ef83245553ea814f4f3be67f5bb555161378': 1.0, // TETH
    };

    // Default price if not found
    return mockPrices[tokenAddress.toLowerCase()] || 1.0;
  }

  getPriceImpact(
    reserveA: bigint,
    reserveB: bigint,
    amountIn: bigint,
    isTokenAIn = true,
  ): number {
    const rA = BigInt(reserveA);
    const rB = BigInt(reserveB);
    const input = BigInt(amountIn);

    const inputWithFee = input;
    const newReserveA = isTokenAIn ? rA + input : rA;
    const newReserveB = isTokenAIn ? rB : rB + input;

    const currentPrice = Number(rB) / Number(rA);
    const newPrice = Number(newReserveB) / Number(newReserveA + inputWithFee);

    return Math.abs((currentPrice - newPrice) / currentPrice) * 100; // in %
  }

  async getMinAmoutOut(
    tokenA: string,
    tokenB: string,
    amountIn: string,
    slippagePercent = 0.5,
  ): Promise<{ amountOut: bigint; priceImpact: number }> {
    const [resA, resB] = await this.blockchainService.getReserves(
      tokenA,
      tokenB,
    );

    const rIn = tokenA === CONTRACT_ADDRESS.ZTARKNET_TOKEN ? resA : resB;
    const rOut = CONTRACT_ADDRESS.ZTARKNET_TOKEN ? resB : resA;

    const parsedAmountIn = parseUnits(amountIn, 18);

    if (resA === 0n || resB === 0n) return undefined;
    const numerator = parsedAmountIn * rOut;
    const denominator = rIn + parsedAmountIn;

    const amountOut = numerator / denominator;

    const slippageMultiplier = BigInt(
      Math.floor((100 - slippagePercent) * 1000),
    ); // e.g. 99.5% → 995
    // Price = reserveB / reserveA → how much TokenB you get for 1 TokenA
    const minAmountOut = (amountOut * slippageMultiplier) / 100000n;

    return {
      amountOut: minAmountOut,
      priceImpact: this.getPriceImpact(
        rIn,
        rOut,
        parsedAmountIn,
        tokenA === CONTRACT_ADDRESS.ZTARKNET_TOKEN,
      ),
    };
  }

  async simulateSwap(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: string,
  ): Promise<{ amountOut: string; priceImpact: number }> {
    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount. Must be a positive number.');
    }

    //!TODO Replace with real price fetching logic
    const amoutOut = await this.getMinAmoutOut(
      tokenInAddress,
      tokenOutAddress,
      amountIn,
    );

    if (!amoutOut) {
      throw new Error('Insufficient liquidity');
    }

    return {
      amountOut: formatUnits(amoutOut.amountOut, 18),
      priceImpact: amoutOut.priceImpact,
    };
  }

  getTokenSymbol(tokenAddress: string): string {
    const token = Object.values(TOKENS).find(
      (t) => t.attributes.address.toLowerCase() === tokenAddress.toLowerCase(),
    );
    return token?.attributes.symbol.toUpperCase() || 'TOKEN';
  }

  /**
   * Get default token (STRK)
   */
  getDefaultToken(): string {
    const strkToken = Object.values(TOKENS).find(
      (t) => t.attributes.symbol.toLowerCase() === 'strk',
    );
    return strkToken?.attributes.address || '';
  }

  getAvailableTokens(): Array<{
    address: string;
    symbol: string;
    name: string;
  }> {
    return Object.values(TOKENS).map((token) => ({
      address: token.attributes.address,
      symbol: token.attributes.symbol.toUpperCase(),
      name: token.attributes.name,
    }));
  }

  validateAmount(amount: string): boolean {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && isFinite(num);
  }

  async getSwapOverview(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: string,
    amountOut: string,
  ): Promise<{
    from: { amount: string; symbol: string };
    to: { symbol: string };
    estimatedValue: string;
    estimatedOutput: string;
    route: string;
    priceIn: number;
    priceOut: number;
  }> {
    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount');
    }

    const priceIn = await this.getMockPrice(tokenInAddress);
    const priceOut = await this.getMockPrice(tokenOutAddress);
    const tokenInSymbol = this.getTokenSymbol(tokenInAddress);
    const tokenOutSymbol = this.getTokenSymbol(tokenOutAddress);

    // Calculate estimated output
    const valueInUSD = amount * priceIn;

    return {
      from: {
        amount: amountIn,
        symbol: tokenInSymbol,
      },
      to: {
        symbol: tokenOutSymbol,
      },
      estimatedValue: `~$${valueInUSD.toFixed(2)}`,
      estimatedOutput: `${amountOut} ${tokenOutSymbol}`,
      route: `${tokenInSymbol} → ${tokenOutSymbol}`,
      priceIn,
      priceOut,
    };
  }
}
