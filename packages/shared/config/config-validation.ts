import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureValidation(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
}
