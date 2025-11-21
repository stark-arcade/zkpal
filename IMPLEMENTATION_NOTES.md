# Implementation Notes & Required Dependencies

## 📦 Required Dependencies to Install

### 1. Core Dependencies (Already in package.json)
- ✅ `@nestjs/common`, `@nestjs/core`
- ✅ `@nestjs/mongoose`
- ✅ `@nestjs/config`
- ✅ `nestjs-telegraf`, `telegraf`
- ✅ `mongoose`

### 2. Missing Dependencies (Need to Install)

#### For Encryption & Security
```bash
pnpm add bcrypt @types/bcrypt
```

#### For Scheduling (Background Jobs)
```bash
pnpm add @nestjs/schedule
```

#### For Blockchain Integration
```bash
# Choose one based on your Starknet SDK preference
pnpm add starknet
# OR
pnpm add starknetjs
# OR your custom Starknet SDK
```

### 3. Optional Dependencies
```bash
# For better error handling
pnpm add @nestjs/axios

# For logging
pnpm add nestjs-pino pino pino-pretty

# For validation
pnpm add class-validator class-transformer
```

## 🔧 Configuration Required

### 1. Update BlockchainService
The `BlockchainService` contains placeholder implementations. You need to:

1. **Import your Starknet SDK**:
   ```typescript
   // Example for starknet package
   import { Account, RpcProvider, ec } from 'starknet';
   ```

2. **Implement generateWallet()**:
   ```typescript
   async generateWallet() {
     const privateKey = ec.stark.randomPrivateKey();
     const publicKey = ec.stark.getPublicKey(privateKey);
     const address = ec.stark.computeAddress(publicKey);
     
     return {
       address,
       privateKey: privateKey.toString(),
       publicKey: publicKey.toString(),
     };
   }
   ```

3. **Implement createAccountFromPrivateKey()**:
   ```typescript
   async createAccountFromPrivateKey(privateKey: string, address: string) {
     const provider = new RpcProvider({ nodeUrl: this.rpcUrl });
     return new Account(provider, address, privateKey);
   }
   ```

4. **Implement getBalance()**:
   ```typescript
   async getBalance(address: string, tokenAddress?: string) {
     const provider = new RpcProvider({ nodeUrl: this.rpcUrl });
     if (tokenAddress) {
       // ERC20 token balance
       const contract = new Contract(ERC20_ABI, tokenAddress, provider);
       const balance = await contract.balanceOf(address);
       return balance.toString();
     } else {
       // Native token balance
       const balance = await provider.getBalance(address);
       return balance.toString();
     }
   }
   ```

5. **Implement sendToken()**:
   ```typescript
   async sendToken(account: Account, toAddress: string, amount: string, tokenAddress: string) {
     const contract = new Contract(ERC20_ABI, tokenAddress, account);
     const tx = await contract.transfer(toAddress, amount);
     await account.waitForTransaction(tx.transaction_hash);
     return tx.transaction_hash;
   }
   ```

## 🗄️ Database Setup

### MongoDB Connection
Ensure MongoDB is running and accessible:
```bash
# Using Docker
docker run -d -p 27017:27017 --name mongodb mongo

# Or use MongoDB Atlas connection string
```

### Environment Variables
Create `.env` file in root directory:
```env
MONGODB_URI=mongodb://localhost:27017/zkpal
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
RPC_URL=https://ztarknet-madara.d.karnot.xyz
PORT=3000
```

## 🚀 Running the Application

1. **Install all dependencies**:
   ```bash
   pnpm install
   ```

2. **Build shared package**:
   ```bash
   cd packages/shared
   pnpm build
   cd ../..
   ```

3. **Start the application**:
   ```bash
   cd packages/api-service
   pnpm start:dev
   ```

## 🧪 Testing the Bot

1. **Start the bot** and find it on Telegram
2. **Send `/start`** to initialize
3. **Send `/createwallet`** and follow prompts
4. **Send `/login`** to unlock wallet
5. **Send `/balance`** to check balance
6. **Send `/send`** to send tokens (when ready)

## ⚠️ Important Notes

### Security
- ✅ Private keys are encrypted with AES-256-GCM
- ✅ Passwords are hashed with bcrypt
- ✅ Decrypted keys expire after 30 minutes
- ⚠️ Never commit `.env` file
- ⚠️ Use strong passwords in production
- ⚠️ Enable HTTPS in production

### Error Handling
- The current implementation has basic error handling
- Consider adding:
  - Retry logic for blockchain calls
  - Better error messages for users
  - Logging for debugging
  - Rate limiting

### Production Checklist
- [ ] Replace placeholder blockchain implementations
- [ ] Add comprehensive error handling
- [ ] Add logging (Winston/Pino)
- [ ] Add monitoring (Prometheus/Grafana)
- [ ] Add rate limiting
- [ ] Add request validation
- [ ] Set up CI/CD
- [ ] Security audit
- [ ] Load testing
- [ ] Backup strategy for MongoDB

## 📝 File Structure Summary

```
✅ Created Files:
- packages/shared/models/schema/session.schema.ts
- packages/shared/utils/encryption.service.ts
- packages/shared/utils/constants.ts
- packages/api-service/src/auth/session.service.ts
- packages/api-service/src/auth/auth.module.ts
- packages/api-service/src/wallet/wallet.service.ts
- packages/api-service/src/wallet/transaction.service.ts
- packages/api-service/src/wallet/wallet.module.ts
- packages/api-service/src/blockchain/blockchain.service.ts
- packages/api-service/src/blockchain/blockchain.module.ts
- packages/api-service/src/users/users.service.ts
- packages/api-service/src/users/users.module.ts
- packages/api-service/src/telegram/handlers/wallet.handler.ts
- packages/api-service/src/scheduler/scheduler.service.ts
- packages/api-service/src/scheduler/scheduler.module.ts

✅ Updated Files:
- packages/shared/models/schema/wallet.schema.ts
- packages/shared/models/schema/transaction.schema.ts
- packages/shared/models/schema/index.ts
- packages/api-service/src/telegram/telegram.service.ts
- packages/api-service/src/telegram/telegram.module.ts
- packages/api-service/src/app.module.ts
- packages/api-service/src/main.ts
```

## 🔄 Next Steps

1. **Install missing dependencies** (bcrypt, @nestjs/schedule)
2. **Implement Starknet SDK integration** in BlockchainService
3. **Test wallet creation** flow
4. **Test transaction flow**
5. **Add error handling** and logging
6. **Deploy to production** (when ready)

