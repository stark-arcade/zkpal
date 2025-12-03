import { Injectable } from '@nestjs/common';
import { TOKENS } from '@app/shared/ztarknet/tokens';

@Injectable()
export class SwapService {
  async getPrice(tokenAddress: string): Promise<number> {
    const mockPrices: Record<string, number> = {
      // STRK (native token)
      '0x01ad102b4c4b3e40a51b6fb8a446275d600555bd63a95cdceed3e5cef8a6bc1d': 50.0,
      // Test tokens
      '0x3adfa5dfa8350ea015fe370434ef83245553ea814f4f3be67f5bb555161378': 1.0, // TETH
    };

    // Default price if not found
    return mockPrices[tokenAddress.toLowerCase()] || 1.0;
  }

  async simulateSwap(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: string,
  ): Promise<string> {
    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount. Must be a positive number.');
    }

    //!TODO Replace with real price fetching logic
    const priceIn = await this.getPrice(tokenInAddress);
    const priceOut = await this.getPrice(tokenOutAddress);

    const valueInUSD = amount * priceIn;
    const amountOut = valueInUSD / priceOut;

    //  Mock slippage of 0.5%
    const amountOutWithSlippage = amountOut * 0.995;

    return amountOutWithSlippage.toFixed(6);
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

    const priceIn = await this.getPrice(tokenInAddress);
    const priceOut = await this.getPrice(tokenOutAddress);
    const tokenInSymbol = this.getTokenSymbol(tokenInAddress);
    const tokenOutSymbol = this.getTokenSymbol(tokenOutAddress);

    // Calculate estimated output
    const valueInUSD = amount * priceIn;
    const amountOut = valueInUSD / priceOut;
    const amountOutWithSlippage = amountOut * 0.995; // Apply 0.5% slippage

    return {
      from: {
        amount: amountIn,
        symbol: tokenInSymbol,
      },
      to: {
        symbol: tokenOutSymbol,
      },
      estimatedValue: `~$${valueInUSD.toFixed(2)}`,
      estimatedOutput: `${amountOutWithSlippage.toFixed(6)} ${tokenOutSymbol}`,
      route: `${tokenInSymbol} → ${tokenOutSymbol}`,
      priceIn,
      priceOut,
    };
  }
}
