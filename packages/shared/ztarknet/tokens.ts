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
} as const;
