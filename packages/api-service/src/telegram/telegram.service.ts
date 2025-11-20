import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot, Command, Update } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';

@Update()
@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  async onModuleInit() {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Get help info' },
      { command: 'weather', description: 'Get weather info' },
      { command: 'news', description: 'Get news updates' },
      { command: 'joke', description: 'Tell a joke' },
    ]);
  }

  @Command('start')
  async onStart(ctx: Context) {
    await ctx.reply('Welcome! Use /help to see available commands.');
  }

  @Command('help')
  async onHelp(ctx: Context) {
    await ctx.reply('Commands:\n/start\n/help\n/weather\n/news\n/joke');
  }

  @Command('weather')
  async onWeather(ctx: Context) {
    await ctx.reply('Today is sunny with a high of 25°C.');
  }

  @Command('news')
  async onNews(ctx: Context) {
    await ctx.reply('Breaking News: Zkpal Telegram Bot example launched!');
  }

  @Command('joke')
  async onJoke(ctx: Context) {
    await ctx.reply(
      'Why did the developer go broke? Because he used up all his cache!',
    );
  }
}
