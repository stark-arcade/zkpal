import { CONTRACT_ADDRESS } from './constants';

export interface IToken {
  id: string;
  attributes: {
    address: `0x${string}`;
    name: string;
    symbol: string;
    decimals: number;
    initialSupply: string;
  };
}

export const TOKENS: { [key: `0x${string}`]: IToken } = {
  '0x0': {
    id: 'starknet_native',
    attributes: {
      address: CONTRACT_ADDRESS.ZTARKNET_TOKEN as `0x${string}`,
      name: 'starknet',
      symbol: 'strk',
      decimals: 18,
      initialSupply: '',
    },
  },
  //!TODO Test SWAP TOKEN
  '0x1': {
    id: 'test_token_usdc',
    attributes: {
      address:
        '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
      name: 'Test USDC',
      symbol: 'tusdc',
      decimals: 18,
      initialSupply: '',
    },
  },
  '0x2': {
    id: 'test_token_eth',
    attributes: {
      address:
        '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`,
      name: 'Test ETH',
      symbol: 'teth',
      decimals: 18,
      initialSupply: '',
    },
  },
  '0x3': {
    id: 'test_token_btc',
    attributes: {
      address:
        '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`,
      name: 'Test BTC',
      symbol: 'tbtc',
      decimals: 18,
      initialSupply: '',
    },
  },
  '0x4': {
    id: 'test_token_dai',
    attributes: {
      address:
        '0x4444444444444444444444444444444444444444444444444444444444444444' as `0x${string}`,
      name: 'Test DAI',
      symbol: 'tdai',
      decimals: 18,
      initialSupply: '',
    },
  },
} as const;
