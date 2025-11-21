import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureSwagger } from 'shared/config/config-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 Application is running on: http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
