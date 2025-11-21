// Session and security constants
export const SESSION_CONFIG = {
  EXPIRY_HOURS: 24, // Session expiration in hours
  KEY_UNLOCK_MINUTES: 30, // Private key unlock duration in minutes
  MAX_FAILED_ATTEMPTS: 5, // Maximum failed password attempts
  LOCKOUT_DURATION_MINUTES: 30, // Account lockout duration
} as const;

// Password validation
export const PASSWORD_CONFIG = {
  MIN_LENGTH: 8,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL: false, // Optional
} as const;

// Transaction constants
export const TRANSACTION_CONFIG = {
  DEFAULT_SLIPPAGE: 0.5, // 0.5% default slippage for swaps
  MAX_RETRIES: 3, // Maximum retry attempts for failed transactions
} as const;

// Network constants
export const NETWORK_CONFIG = {
  DEFAULT_NETWORK: 'ztarknet',
  CONFIRMATION_BLOCKS: 1, // Blocks to wait for confirmation
} as const;

