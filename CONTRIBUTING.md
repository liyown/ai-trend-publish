# Contributing to ai-trend-publish

Thank you for contributing to ai-trend-publish!

## Development Setup

1. **Requirements**
   - Node.js 18+ and pnpm
   - A Telegram Bot Token (from @BotFather)
   - API keys for content sources (optional)

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Environment configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your Telegram bot token and API keys
   ```

4. **Run in development mode**
   ```bash
   pnpm dev
   ```

## Project Structure

```
ai-trend-publish/
├── src/
│   ├── bot/           # Telegram bot handlers
│   ├── services/      # Content fetching and processing
│   └── utils/         # Helper functions
├── deno.json          # Deno configuration
└── .env.example       # Environment variables template
```

## Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Code style**
   - Use TypeScript for all new code
   - Run `pnpm lint` before committing
   - Write self-documenting code

3. **Test your changes**
   ```bash
   pnpm test
   pnpm lint
   ```

4. **Commit and push**
   ```bash
   git commit -m "feat: add your feature"
   git push origin feat/your-feature-name
   ```

## Pull Request Process

1. Fork the repository
2. Create your feature branch
3. Make changes with adequate testing
4. Submit a PR with clear description

## Reporting Issues

- Use GitHub Issues for bug reports
- Include Node.js/Deno version
- Include steps to reproduce

## License

By contributing, you agree your contributions are licensed under the project license.
