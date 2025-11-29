export const ZKPAL_ABI = [
  {
    type: 'impl',
    name: 'ZkPalImpl',
    interface_name: 'contracts::zkPal::IZkPal',
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
    type: 'struct',
    name: 'core::array::Span::<core::felt252>',
    members: [
      {
        name: 'snapshot',
        type: '@core::array::Array::<core::felt252>',
      },
    ],
  },
  {
    type: 'struct',
    name: 'contracts::zkPal::TransactParam',
    members: [
      {
        name: 'root_ids',
        type: 'core::array::Span::<core::felt252>',
      },
      {
        name: 'root_hashes',
        type: 'core::array::Span::<core::felt252>',
      },
      {
        name: 'nullifier_hashes',
        type: 'core::array::Span::<core::felt252>',
      },
      {
        name: 'new_commitments',
        type: 'core::array::Span::<core::felt252>',
      },
      {
        name: 'amount_out',
        type: 'core::integer::u256',
      },
      {
        name: 'token_out',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'recipient_withdraw',
        type: 'core::starknet::contract_address::ContractAddress',
      },
    ],
  },
  {
    type: 'enum',
    name: 'core::bool',
    variants: [
      {
        name: 'False',
        type: '()',
      },
      {
        name: 'True',
        type: '()',
      },
    ],
  },
  {
    type: 'interface',
    name: 'contracts::zkPal::IZkPal',
    items: [
      {
        type: 'function',
        name: 'set_verifier',
        inputs: [
          {
            name: 'verifier',
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'set_zkp_verifier',
        inputs: [
          {
            name: 'zkp_verifier',
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'shield',
        inputs: [
          {
            name: 'commitment',
            type: 'core::felt252',
          },
          {
            name: 'token',
            type: 'core::starknet::contract_address::ContractAddress',
          },
          {
            name: 'amount',
            type: 'core::integer::u256',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'transact',
        inputs: [
          {
            name: 'input',
            type: 'contracts::zkPal::TransactParam',
          },
          {
            name: 'zkp',
            type: 'core::array::Span::<core::felt252>',
          },
          {
            name: 'proof',
            type: 'core::array::Span::<core::felt252>',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'unshield',
        inputs: [
          {
            name: 'input',
            type: 'contracts::zkPal::TransactParam',
          },
          {
            name: 'zkp',
            type: 'core::array::Span::<core::felt252>',
          },
          {
            name: 'proof',
            type: 'core::array::Span::<core::felt252>',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'get_verifier',
        inputs: [],
        outputs: [
          {
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'get_zkp_verifier',
        inputs: [],
        outputs: [
          {
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'is_supported_token',
        inputs: [
          {
            name: 'token',
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        outputs: [
          {
            type: 'core::bool',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'get_current_tree_id',
        inputs: [],
        outputs: [
          {
            type: 'core::integer::u256',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'is_spent',
        inputs: [
          {
            name: 'nullifier_hash',
            type: 'core::felt252',
          },
        ],
        outputs: [
          {
            type: 'core::bool',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'is_known_commitment',
        inputs: [
          {
            name: 'commitment',
            type: 'core::felt252',
          },
        ],
        outputs: [
          {
            type: 'core::bool',
          },
        ],
        state_mutability: 'view',
      },
    ],
  },
  {
    type: 'impl',
    name: 'OwnableMixinImpl',
    interface_name: 'openzeppelin_access::ownable::interface::OwnableABI',
  },
  {
    type: 'interface',
    name: 'openzeppelin_access::ownable::interface::OwnableABI',
    items: [
      {
        type: 'function',
        name: 'owner',
        inputs: [],
        outputs: [
          {
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        state_mutability: 'view',
      },
      {
        type: 'function',
        name: 'transfer_ownership',
        inputs: [
          {
            name: 'new_owner',
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'renounce_ownership',
        inputs: [],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'transferOwnership',
        inputs: [
          {
            name: 'newOwner',
            type: 'core::starknet::contract_address::ContractAddress',
          },
        ],
        outputs: [],
        state_mutability: 'external',
      },
      {
        type: 'function',
        name: 'renounceOwnership',
        inputs: [],
        outputs: [],
        state_mutability: 'external',
      },
    ],
  },
  {
    type: 'constructor',
    name: 'constructor',
    inputs: [
      {
        name: 'token',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'verifier',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'zkp_verifier',
        type: 'core::starknet::contract_address::ContractAddress',
      },
      {
        name: 'owner',
        type: 'core::starknet::contract_address::ContractAddress',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::NewTreeCreated',
    kind: 'struct',
    members: [
      {
        name: 'tree_id',
        type: 'core::integer::u256',
        kind: 'key',
      },
      {
        name: 'root',
        type: 'core::felt252',
        kind: 'data',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::NewLeafInserted',
    kind: 'struct',
    members: [
      {
        name: 'tree_id',
        type: 'core::integer::u256',
        kind: 'key',
      },
      {
        name: 'leaf_index',
        type: 'core::integer::u256',
        kind: 'key',
      },
      {
        name: 'root',
        type: 'core::felt252',
        kind: 'data',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::AssetShielded',
    kind: 'struct',
    members: [
      {
        name: 'commitment',
        type: 'core::felt252',
        kind: 'key',
      },
      {
        name: 'token',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'key',
      },
      {
        name: 'amount',
        type: 'core::integer::u256',
        kind: 'data',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::TransactEmitted',
    kind: 'struct',
    members: [
      {
        name: 'tree_id',
        type: 'core::integer::u256',
        kind: 'key',
      },
      {
        name: 'nullifier_hash',
        type: 'core::array::Span::<core::felt252>',
        kind: 'data',
      },
      {
        name: 'new_commitments',
        type: 'core::array::Span::<core::felt252>',
        kind: 'data',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::AssestUnshielded',
    kind: 'struct',
    members: [
      {
        name: 'tree_id',
        type: 'core::integer::u256',
        kind: 'key',
      },
      {
        name: 'nullifier_hashes',
        type: 'core::array::Span::<core::felt252>',
        kind: 'key',
      },
      {
        name: 'token',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'data',
      },
      {
        name: 'to',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'data',
      },
      {
        name: 'amount',
        type: 'core::integer::u256',
        kind: 'data',
      },
      {
        name: 'new_commitments',
        type: 'core::array::Span::<core::felt252>',
        kind: 'data',
      },
    ],
  },
  {
    type: 'event',
    name: 'openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferred',
    kind: 'struct',
    members: [
      {
        name: 'previous_owner',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'key',
      },
      {
        name: 'new_owner',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'key',
      },
    ],
  },
  {
    type: 'event',
    name: 'openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferStarted',
    kind: 'struct',
    members: [
      {
        name: 'previous_owner',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'key',
      },
      {
        name: 'new_owner',
        type: 'core::starknet::contract_address::ContractAddress',
        kind: 'key',
      },
    ],
  },
  {
    type: 'event',
    name: 'openzeppelin_access::ownable::ownable::OwnableComponent::Event',
    kind: 'enum',
    variants: [
      {
        name: 'OwnershipTransferred',
        type: 'openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferred',
        kind: 'nested',
      },
      {
        name: 'OwnershipTransferStarted',
        type: 'openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferStarted',
        kind: 'nested',
      },
    ],
  },
  {
    type: 'event',
    name: 'contracts::zkPal::ZkPal::Event',
    kind: 'enum',
    variants: [
      {
        name: 'NewTreeCreated',
        type: 'contracts::zkPal::ZkPal::NewTreeCreated',
        kind: 'nested',
      },
      {
        name: 'NewLeafInserted',
        type: 'contracts::zkPal::ZkPal::NewLeafInserted',
        kind: 'nested',
      },
      {
        name: 'AssetShielded',
        type: 'contracts::zkPal::ZkPal::AssetShielded',
        kind: 'nested',
      },
      {
        name: 'TransactEmitted',
        type: 'contracts::zkPal::ZkPal::TransactEmitted',
        kind: 'nested',
      },
      {
        name: 'AssestUnshielded',
        type: 'contracts::zkPal::ZkPal::AssestUnshielded',
        kind: 'nested',
      },
      {
        name: 'OwnableEvent',
        type: 'openzeppelin_access::ownable::ownable::OwnableComponent::Event',
        kind: 'flat',
      },
    ],
  },
];
