# 🤖 Kraken AI Trading Bot

Fully automated, AI-learning trading bot for Kraken CAD spot markets (BTC/CAD, ETH/CAD, SOL/CAD).

## 🎯 Features

- **Fully Automated**: 24/7 trading without manual intervention
- **AI Learning**: Reinforcement learning adapts to market conditions
- **Risk Management**: Built-in stop-loss, take-profit, and daily limits
- **Technical Analysis**: EMA, RSI, ATR, and volume-based signals
- **Telegram Integration**: Real-time notifications and remote commands
- **MySQL Database**: Complete trade history and performance tracking
- **PM2 Ready**: Production-ready with process management

## 📊 Strategy

### Entry Conditions (Long-Only)
1. **Regime Filter**: Price > EMA200 (bullish market)
2. **Trend**: EMA20 > EMA50 (uptrend)
3. **RSI**: < 38 (oversold - buy opportunity)
4. **Volatility**: ATR between 0.4% and 2.0%
5. **Volume**: Z-score ≥ 0.5 (strong volume)
6. **Confidence**: Weighted score ≥ 0.65

### Exit Conditions
- **Stop Loss**: 1.2 × ATR below entry
- **Take Profit**: 2.4 × ATR above entry (2:1 R/R ratio)
- **RSI Overbought**: > 62
- **Regime Change**: Price drops below EMA200

### AI Learning
- **Per-Trade Learning**: Updates weights after each closed position
- **Periodic Optimization**: Every 6 hours, adjusts parameters based on:
  - Win Rate < 52% → Adjust RSI thresholds
  - Profit Factor < 1.2 → Increase take profit
  - Max Drawdown > 8×risk → Tighten volatility filter

## 🚀 Installation

### Prerequisites
- Node.js 18+ 
- MySQL 5.7+ or MariaDB 10+
- Kraken account with API keys
- Telegram bot (optional)

### Step 1: Clone or Create Project
```bash
cd C:\xampp\htdocs\kraken-ai-trade
npm install
```

### Step 2: Set Up Database
```bash
# Start MySQL (if using XAMPP)
# Open phpMyAdmin or MySQL CLI and run:
mysql -u root -p < schema.sql
```

### Step 3: Configure Environment
Create a `.env` file in the project root:

```bash
# Copy the example (if available)
# Or create .env manually with the following content:

# Kraken API Configuration
KRAKEN_API_KEY=your_kraken_api_key_here
KRAKEN_API_SECRET=your_kraken_api_secret_here

# Trading Configuration
TRADING_SYMBOLS=BTC/CAD,ETH/CAD,SOL/CAD
TIMEFRAME=1m
RISK_CAD=2
MAX_DAILY_LOSS_CAD=5
MAX_DAILY_TRADES=10
COOLDOWN_MINUTES=5

# Strategy Parameters
RSI_OVERSOLD=38
RSI_OVERBOUGHT=62
EMA_FAST=20
EMA_SLOW=50
EMA_REGIME=200
ATR_LOW_PCT=0.4
ATR_HIGH_PCT=2.0
VOL_Z_MIN=0.5

# AI Configuration
AI_OPT_INTERVAL_MIN=360
AI_LEARNING_RATE=0.01

# Confidence Weights (initial values)
WEIGHT_RSI=0.40
WEIGHT_EMA=0.30
WEIGHT_ATR=0.15
WEIGHT_VOL=0.15

# MySQL Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=kraken_trader

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Bot Configuration
LOOP_INTERVAL_MS=60000
ENABLE_TRADING=true
ENABLE_TELEGRAM=true
```

### Step 4: Get Kraken API Keys
1. Log in to [Kraken](https://www.kraken.com/)
2. Go to Settings → API
3. Create new API key with **"Query Funds"** and **"Create & Modify Orders"** permissions
4. **DO NOT** enable "Withdraw Funds" for security
5. Copy API Key and Secret to `.env`

### Step 5: Set Up Telegram Bot (Optional)
1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow instructions
3. Copy the bot token to `.env`
4. Start a chat with your bot
5. Get your chat ID by visiting: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
6. Send a message to your bot, refresh the URL, and copy the `chat.id` value

## 🎮 Usage

### Development Mode
```bash
npm start
# or
npm run dev
```

### Production Mode (PM2)
```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# Start the bot
npm run pm2:start

# View logs
npm run pm2:logs

# Stop the bot
npm run pm2:stop

# Restart the bot
npm run pm2:restart

# View PM2 dashboard
pm2 monit
```

## 📱 Telegram Commands

Once the bot is running, you can control it via Telegram:

- `/status` - Show current positions, balance, and PnL
- `/daily` - Show today's performance summary
- `/ai_status` - Show AI weights and parameters
- `/flat` - Emergency close all positions
- `/help` - Show available commands

## 📈 Performance Metrics

The bot tracks:
- **Win Rate**: Percentage of profitable trades
- **Profit Factor**: Gross profit / Gross loss
- **Max Drawdown**: Largest peak-to-trough decline
- **Average Win/Loss**: Mean PnL per winning/losing trade
- **Sharpe Ratio**: Risk-adjusted returns (to be implemented)

## ⚙️ Configuration

### Risk Parameters
- `RISK_CAD`: CAD amount to risk per trade (default: 2)
- `MAX_DAILY_LOSS_CAD`: Maximum daily loss before stopping (default: 5)
- `MAX_DAILY_TRADES`: Maximum trades per day (default: 10)
- `COOLDOWN_MINUTES`: Wait time after a losing trade (default: 5)

### Strategy Parameters
- `RSI_OVERSOLD`: RSI threshold for buy signals (default: 38)
- `RSI_OVERBOUGHT`: RSI threshold for sell signals (default: 62)
- `EMA_FAST/SLOW/REGIME`: Moving average periods (20/50/200)
- `ATR_LOW_PCT/ATR_HIGH_PCT`: Volatility range (0.4% - 2.0%)
- `VOL_Z_MIN`: Minimum volume z-score (default: 0.5)

### AI Parameters
- `AI_OPT_INTERVAL_MIN`: Optimization frequency in minutes (default: 360 = 6 hours)
- `AI_LEARNING_RATE`: Learning rate for weight updates (default: 0.01)

## 🗂️ Project Structure

```
kraken-ai-trade/
├── src/
│   ├── index.js          # Main entry point and trading loop
│   ├── exchange.js       # Kraken API integration (CCXT)
│   ├── strategy.js       # Trading strategy and signals
│   ├── ai.js             # AI learning and optimization
│   ├── db.js             # MySQL database operations
│   ├── telegram.js       # Telegram bot integration
│   ├── indicators.js     # Technical indicators (EMA, RSI, ATR)
│   └── utils.js          # Utility functions
├── schema.sql            # Database schema
├── package.json          # Dependencies
├── .env                  # Configuration (create this)
├── ai-weights.json       # AI weights (auto-generated)
└── README.md             # This file
```

## 🔒 Security

- **API Keys**: Never commit `.env` to version control
- **Permissions**: Only enable necessary API permissions (no withdrawal)
- **Testing**: Start with small `RISK_CAD` values
- **Monitoring**: Always monitor the bot, especially in the first 24-48 hours

## ⚠️ Disclaimer

**This bot is for educational purposes only.**

- Cryptocurrency trading involves significant risk
- Past performance does not guarantee future results
- Only trade with money you can afford to lose
- The authors are not responsible for any financial losses
- Always test thoroughly on paper trading or with minimal capital first

## 🐛 Troubleshooting

### Database Connection Error
```bash
# Check if MySQL is running
# For XAMPP: Start MySQL from control panel
# For standalone MySQL:
net start mysql
```

### Kraken API Rate Limit
The bot uses CCXT with rate limiting enabled. If you see rate limit errors:
- Increase `LOOP_INTERVAL_MS` to 120000 (2 minutes)
- Reduce number of symbols in `TRADING_SYMBOLS`

### Insufficient Data Error
The bot needs at least 200 candles (200 minutes of 1m data). Wait ~3-4 hours for enough data to accumulate.

### Telegram Not Working
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are correct
- Set `ENABLE_TELEGRAM=false` to disable if not using

## 📊 Database Queries

Useful queries for analysis:

```sql
-- View all trades
SELECT * FROM trades ORDER BY opened_at DESC LIMIT 20;

-- Daily performance
SELECT * FROM daily_summary ORDER BY day DESC;

-- AI learning progress
SELECT * FROM ai_weights ORDER BY updated_at DESC LIMIT 10;

-- Win rate by symbol
SELECT 
  symbol, 
  COUNT(*) as trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*) as win_rate,
  SUM(pnl) as total_pnl
FROM trades 
WHERE closed_at IS NOT NULL
GROUP BY symbol;
```

## 🔮 Future Enhancements

- [ ] Multiple timeframe analysis
- [ ] Short selling (if using margin/futures)
- [ ] Advanced backtesting with historical data
- [ ] Web dashboard for monitoring
- [ ] Paper trading mode
- [ ] More sophisticated AI models (LSTM, RL agents)
- [ ] Multi-exchange support
- [ ] Portfolio rebalancing

## 📚 Resources

- [Kraken API Documentation](https://docs.kraken.com/rest/)
- [CCXT Library](https://github.com/ccxt/ccxt)
- [Technical Analysis Basics](https://www.investopedia.com/technical-analysis-4689657)

## 📝 License

ISC License - Use at your own risk

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

---

**Happy Trading! 🚀📈**

*Remember: The best trade is the one you don't take if conditions aren't right.*

