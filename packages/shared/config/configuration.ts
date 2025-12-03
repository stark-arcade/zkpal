import 'dotenv';
import { registerAs } from '@nestjs/config';

// Application configuration
export default registerAs('app', () => {
  console.log('🔍 Loading config from:', process.cwd());

  return {
    mongodb: {
      uri: process.env.MONGODB_URI,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    relayer: {
      ADDRESS: process.env.RELAYER_ADDRESS,
      PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY,
    },
    rpc_url: process.env.RPC_URL || 'https://ztarknet-madara.d.karnot.xyz',
  };
});
