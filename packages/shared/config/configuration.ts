import 'dotenv';
import { registerAs } from '@nestjs/config';

// Application configuration
export default registerAs('app', () => {
  console.log('🔍 Loading config from:', process.cwd());

  return {
    mongodb: {
      uri: process.env.MONGODB_URI,
    },
    server: {
      url: process.env.SERVER_URL || 'http://localhost:3000',
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
  };
});
