export const ROUTE_ABI = [
  {
    type: 'impl',
    name: 'ConstantProductAmm',
    interface_name: 'contracts::mock_amm::IConstantProductAmm',
  },
  {
    type: 'struct',
    name: 'core::integer::u256',
    members: [
      {
        name: 'low',
        type: 'core::integer::u128',
      },
      {
        name: 'high',
        type: 'core::integer::u128',
      },
    ],
  },
  {
    type: 'interface',
    name: 'contracts::mock_amm::IConstantProductAmm',
    items: [
      {
        type: 'function',
        name: 'swap',
        inputs: [
          {
            name: 'token_in',
            type: 'core::starknet::contract_address::ContractAddress',
          },
          {
            name: 'amount_in',
            type: 'core::integer::u256',
          },
        ],
        outputs: [
          {
            type: 'core::integer::u256',
          },
        ],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'add_liquidity',
        inputs: [
          {
            name: 'amount0',
            type: 'core::integer::u256',
          },
          {
            name: 'amount1',
            type: 'core::integer::u256',
          },
        ],
        outputs: [
          {
            type: 'core::integer::u256',
          },
        ],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'remove_liquidity',
        inputs: [
          {
            name: 'shares',
            type: 'core::integer::u256',
          },
        ],
        outputs: [
          {
            type: '(core::integer::u256, core::integer::u256)',
          },
        ],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'get_reserves',
        inputs: [],
        outputs: [
          {
            type: '(core::integer::u256, core::integer::u256)',
          },
        ],
        state_mutability: 'view',
      },
    ],
  },
  {
    type: 'constructor',
    name: 'constructor',
    inputs: [
      {
        name: 'token0',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'token1',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'fee',
        type: 'core::integer::u16',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::mock_amm::ConstantProductAmm::Event',
    kind: 'enum',
    variants: [],
  },
];
