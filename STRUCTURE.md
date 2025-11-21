# Zkpal Trading Bot - Full Structure Documentation

## 📁 Project Structure

```
packages/
├── api-service/              # Main API service
│   └── src/
│       ├── auth/             # Authentication & Session management
│       │   ├── auth.module.ts
│       │   └── session.service.ts
│       │
│       ├── wallet/           # Wallet operations
│       │   ├── wallet.module.ts
│       │   ├── wallet.service.ts
│       │   └── transaction.service.ts
│       │
│       ├── blockchain/      # Blockchain integration
│       │   ├── blockchain.module.ts
│       │   └── blockchain.service.ts
│       │
│       ├── users/           # User management
│       │   ├── users.module.ts
│       │   └── users.service.ts
│       │
│       ├── telegram/        # Telegram bot handlers
│       │   ├── telegram.module.ts
│       │   ├── telegram.service.ts
│       │   └── handlers/
│       │       └── wallet.handler.ts
│       │
│       ├── scheduler/       # Background jobs
│       │   ├── scheduler.module.ts
│       │   └── scheduler.service.ts
│       │
│       ├── app.module.ts
│       └── main.ts
│
└── shared/                  # Shared utilities & models
    ├── models/
    │   └── schema/
    │       ├── user.schema.ts
    │       ├── wallet.schema.ts
    │       ├── session.schema.ts
    │       └── transaction.schema.ts
    │
    └── utils/
        ├── encryption.service.ts
        └── constants.ts
```

## 🗄️ Database Schemas

### 1. User Schema
- `telegramId`: Unique Telegram user ID
- `telegramUsername`: Optional username
- `isWalletCreated`: Boolean flag
- `status`: User status (pending/active/suspended)
- `lastActivityAt`: Last interaction timestamp

### 2. Wallet Schema
- `userId`: Reference to User
- `address`: Starknet wallet address
- `encryptedPrivateKey`: AES-256-GCM encrypted private key
- `passwordHash`: Bcrypt hash for password verification
- `encryptionSalt`: Salt for key derivation
- `iv`: Initialization vector for AES
- `network`: Network identifier (ztarknet)

### 3. Session Schema (Unified)
- `userId`: Reference to User
- `telegramId`: Telegram user ID
- `sessionToken`: Unique session identifier
- `passwordHash`: Bcrypt hash for verification
- `isVerified`: Password verification status
- `decryptedPrivateKey`: Temporarily stored decrypted key (when unlocked)
- `keyExpiresAt`: Key unlock expiration time
- `expiresAt`: Overall session expiration
- `failedAttempts`: Failed password attempts counter
- `lockedUntil`: Account lockout timestamp

### 4. Transaction Schema
- `userId`: Reference to User
- `walletAddress`: Sender wallet address
- `txHash`: Blockchain transaction hash
- `type`: Transaction type (send/receive/swap)
- `tokenAddress`: Token contract address
- `amount`: Transaction amount
- `recipientAddress`: Recipient address
- `status`: Transaction status (pending/confirmed/failed)

## 🔐 Security Architecture

### Encryption Flow

1. **Password Hashing**: Bcrypt (12 rounds)
   - Used for password verification
   - Stored in Wallet.passwordHash and Session.passwordHash

2. **Private Key Encryption**: AES-256-GCM
   - Key derivation: PBKDF2 (100,000 iterations, SHA-256)
   - Encryption key derived from user password + salt
   - Stored: `encryptedPrivateKey`, `encryptionSalt`, `iv`

3. **Temporary Key Storage**:
   - Decrypted private key stored in Session.decryptedPrivateKey
   - Auto-expires after 30 minutes (configurable)
   - Automatically cleared by cleanup job

### Session Management

- **Session Lifecycle**:
  1. Created when user first interacts
  2. Password verified → `isVerified = true`
  3. Wallet unlocked → `decryptedPrivateKey` stored temporarily
  4. Key expires after 30 minutes
  5. Session expires after 24 hours

- **Security Features**:
  - Max 5 failed password attempts → account lockout
  - Lockout duration: 30 minutes
  - Automatic cleanup of expired sessions/keys
  - Session tokens are cryptographically random

## 🔄 Service Layer

### EncryptionService
- `hashPassword()`: Bcrypt password hashing
- `verifyPassword()`: Password verification
- `encryptPrivateKey()`: AES-256-GCM encryption
- `decryptPrivateKey()`: AES-256-GCM decryption
- `generateSessionToken()`: Random session token generation

### SessionService
- `createSession()`: Create new session
- `unlockWallet()`: Verify password and unlock wallet
- `getDecryptedPrivateKey()`: Get unlocked private key
- `isWalletUnlocked()`: Check unlock status
- `lockWallet()`: Clear decrypted key
- `cleanupExpiredSessions()`: Remove expired sessions/keys

### WalletService
- `createWallet()`: Generate wallet and encrypt private key
- `getWalletByUserId()`: Get user's wallet
- `getBalance()`: Query wallet balance
- `getWalletAddress()`: Get wallet address

### BlockchainService
- `generateWallet()`: Generate Starknet wallet
- `createAccountFromPrivateKey()`: Create Account instance
- `getBalance()`: Query balance
- `sendToken()`: Execute token transfer
- `swapTokens()`: Execute token swap
- `getTransactionStatus()`: Query transaction status

### TransactionService
- `sendToken()`: Execute send transaction
- `swapTokens()`: Execute swap transaction
- `getTransactionHistory()`: Get user's transaction history
- `updateTransactionStatus()`: Update transaction status

### UsersService
- `createOrGetUser()`: Create or retrieve user
- `getUserByTelegramId()`: Get user by Telegram ID
- `updateWalletStatus()`: Update wallet creation status

## 🤖 Telegram Bot Commands

### Available Commands

1. **/start** - Welcome message, check wallet status
2. **/createwallet** - Create new wallet (prompts for password)
3. **/login** - Unlock wallet with password
4. **/balance** - Check wallet balance
5. **/send** - Send tokens (format: `/send <amount> <token_address> <recipient_address>`)
6. **/history** - View transaction history
7. **/logout** - Lock wallet (clear decrypted key)
8. **/help** - Show help message

### User Flow

#### Wallet Creation
```
User: /createwallet
Bot: "Please enter a strong password..."
User: <password>
Bot: "Wallet created! Address: 0x..."
```

#### Transaction Flow
```
User: /login
Bot: "Please enter your password..."
User: <password>
Bot: "Wallet unlocked!"

User: /send 100 0xToken... 0xRecipient...
Bot: "Please confirm by entering your password:"
User: <password>
Bot: "Transaction sent! Hash: 0x..."
```

## ⚙️ Configuration

### Environment Variables (.env)
```env
MONGODB_URI=mongodb://localhost:27017/zkpal
TELEGRAM_BOT_TOKEN=your_bot_token
RPC_URL=https://ztarknet-madara.d.karnot.xyz
PORT=3000
```

### Constants (shared/utils/constants.ts)
- `SESSION_CONFIG`: Session expiration, key unlock duration, max attempts
- `PASSWORD_CONFIG`: Password validation rules
- `TRANSACTION_CONFIG`: Transaction settings (slippage, retries)
- `NETWORK_CONFIG`: Network settings

## 🔄 Background Jobs

### SchedulerService
- **Cleanup Expired Sessions**: Runs every 5 minutes
  - Clears expired decrypted keys
  - Removes expired sessions

- **Update Transaction Statuses**: Runs every minute
  - Updates pending transaction statuses
  - Queries blockchain for confirmations

## 📦 Required Dependencies

### Core Dependencies
```json
{
  "@nestjs/common": "^10.4.20",
  "@nestjs/mongoose": "^10.0.6",
  "@nestjs/schedule": "^4.0.0",
  "nestjs-telegraf": "^2.9.1",
  "telegraf": "^4.16.3",
  "bcrypt": "^5.1.1",
  "mongoose": "^8.4.1",
  "starknet": "^6.0.0"  // Replace with your Starknet SDK
}
```

## 🚀 Getting Started

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Configure Environment**
   - Create `.env` file in root
   - Add required environment variables

3. **Start MongoDB**
   ```bash
   # Using Docker
   docker run -d -p 27017:27017 mongo
   ```

4. **Run Application**
   ```bash
   pnpm run start:dev
   ```

## 🔧 Implementation Notes

### Blockchain Integration
The `BlockchainService` contains placeholder implementations. You need to:
1. Import your Starknet SDK (e.g., `starknet`, `starknetjs`)
2. Implement actual wallet generation
3. Implement Account creation
4. Implement balance queries
5. Implement token transfers
6. Implement swap logic (if needed)

### Security Best Practices
- ✅ Private keys encrypted at rest
- ✅ Passwords hashed with bcrypt
- ✅ Temporary key storage with expiration
- ✅ Account lockout after failed attempts
- ✅ Automatic cleanup of sensitive data
- ✅ Session expiration
- ⚠️ Never log private keys or passwords
- ⚠️ Validate all user inputs
- ⚠️ Use HTTPS in production
- ⚠️ Implement rate limiting

## 📝 Next Steps

1. **Implement Starknet Integration**
   - Replace placeholder code in `BlockchainService`
   - Test wallet generation
   - Test transactions

2. **Add Error Handling**
   - Network error handling
   - Transaction failure recovery
   - User-friendly error messages

3. **Add Features**
   - Token swap functionality
   - Multi-token support
   - Transaction notifications
   - Wallet backup/restore

4. **Testing**
   - Unit tests for services
   - Integration tests
   - E2E tests for Telegram bot

5. **Production Readiness**
   - Add logging (Winston, Pino)
   - Add monitoring (Prometheus)
   - Add rate limiting
   - Add request validation
   - Security audit

