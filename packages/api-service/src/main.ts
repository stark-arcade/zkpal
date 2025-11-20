import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureSwagger } from '@app/shared/config/config-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
