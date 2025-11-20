import { plainToInstance } from 'class-transformer';
import { IsString, IsNotEmpty, IsUrl, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  MONGODB_URI: string;

  // @IsUrl({ require_tld: false })
  // @IsNotEmpty()
  SERVER_URL: string;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_BOT_TOKEN: string;
}

// Check The environment variables using class-validator
export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
