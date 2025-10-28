/**
 * Telegram bot for notifications and commands
 * Enhanced with authorization and advanced notifications
 */

import TelegramBot from 'node-telegram-bot-api';
import { log, formatNumber, getCurrentDate } from './utils.js';
import * as db from './db.js';
import * as ai from './ai.js';

let bot = null;
let chatId = null;
let isEnabled = false;
let allowedUserIds = []; // Whitelist of user IDs

/**
 * Initialize Telegram bot
 * @param {Object} config - Telegram configuration
 * @returns {Promise<void>}
 */
export async function initTelegram(config) {
  if (!config.botToken || !config.chatId) {
    log('Telegram not configured, skipping', 'WARN');
    return;
  }

  try {
    bot = new TelegramBot(config.botToken, { polling: true });
    chatId = config.chatId;
    
    // Parse allowed user IDs (comma-separated)
    if (config.allowedUserIds) {
      allowedUserIds = config.allowedUserIds.split(',').map(id => parseInt(id.trim()));
    } else {
      // If not specified, allow the main chat ID
      allowedUserIds = [parseInt(chatId)];
    }
    
    isEnabled = true;

    // Set up command handlers
    setupCommands();
    
    // Set bot commands menu
    await setupBotCommands();

    log('Telegram bot initialized', 'SUCCESS');
    log(`Allowed users: ${allowedUserIds.join(', ')}`, 'INFO');
    await sendMessage('🤖 Kraken AI Trader started successfully!\n\nKomutları görmek için /help yazın veya menüyü açın.');
  } catch (error) {
    log(`Telegram initialization error: ${error.message}`, 'ERROR');
    isEnabled = false;
  }
}

/**
 * Check if user is authorized
 * @param {number} userId - User ID
 * @returns {boolean} True if authorized
 */
function isAuthorized(userId) {
  return allowedUserIds.length === 0 || allowedUserIds.includes(userId);
}

/**
 * Set up bot commands menu (appears in Telegram menu)
 */
async function setupBotCommands() {
  if (!bot) return;
  
  try {
    await bot.setMyCommands([
      { command: 'start', description: '🤖 Botu başlat' },
      { command: 'status', description: '📊 Pozisyon ve bakiye durumu' },
      { command: 'daily', description: '📅 Günlük performans raporu' },
      { command: 'ai_status', description: '🧠 AI parametreleri ve ağırlıklar' },
      { command: 'optimize', description: '⚙️ Manuel AI optimizasyonu' },
      { command: 'flat', description: '🚨 Acil pozisyon kapatma' },
      { command: 'help', description: '❓ Yardım menüsü' }
    ]);
    log('Telegram bot commands menu set', 'INFO');
  } catch (error) {
    log(`Error setting bot commands: ${error.message}`, 'WARN');
  }
}

/**
 * Set up Telegram command handlers
 */
function setupCommands() {
  if (!bot) return;

  // /start - Welcome message with inline keyboard
  bot.onText(/\/start/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    
    const welcomeMessage = `
🤖 *Kraken AI Trading Bot*

Hoş geldiniz! Bot aktif ve çalışıyor.

📊 *Mevcut Durumu Görün:*
/status - Pozisyon ve bakiye bilgisi
/daily - Bugünkü performans

🧠 *AI Yönetimi:*
/ai\\_status - AI parametreleri
/optimize - Manuel optimizasyon

🚨 *Acil Durum:*
/flat - Tüm pozisyonları kapat

❓ Tüm komutlar için: /help
    `;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'cmd_status' },
          { text: '📅 Daily', callback_data: 'cmd_daily' }
        ],
        [
          { text: '🧠 AI Status', callback_data: 'cmd_ai' },
          { text: '⚙️ Optimize', callback_data: 'cmd_optimize' }
        ],
        [
          { text: '🚨 Flat', callback_data: 'cmd_flat' },
          { text: '❓ Help', callback_data: 'cmd_help' }
        ]
      ]
    };
    
    bot.sendMessage(msg.chat.id, welcomeMessage, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });
  
  // Handle inline keyboard callbacks
  bot.on('callback_query', async (query) => {
    if (!isAuthorized(query.from.id)) {
      bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized' });
      return;
    }
    
    const chatId = query.message.chat.id;
    
    try {
      switch (query.data) {
        case 'cmd_status':
          const status = await getStatusMessage();
          bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
          break;
        case 'cmd_daily':
          const daily = await getDailySummaryMessage();
          bot.sendMessage(chatId, daily, { parse_mode: 'Markdown' });
          break;
        case 'cmd_ai':
          const aiStatus = await getAIStatusMessage();
          bot.sendMessage(chatId, aiStatus, { parse_mode: 'Markdown' });
          break;
        case 'cmd_optimize':
          bot.sendMessage(chatId, '🧠 Optimization will run in next cycle');
          break;
        case 'cmd_flat':
          const openTrades = await db.getOpenTrades();
          if (openTrades.length === 0) {
            bot.sendMessage(chatId, '✅ No open positions');
          } else {
            bot.sendMessage(chatId, 
              `⚠️ Emergency flat requested!\n${openTrades.length} position(s) marked for closure.`
            );
            global.emergencyFlat = true;
          }
          break;
        case 'cmd_help':
          const helpText = `
*📱 Komutlar:*

/status - Pozisyon ve bakiye
/daily - Günlük rapor
/ai\\_status - AI parametreleri
/optimize - Manuel optimizasyon
/flat - Acil pozisyon kapatma
/help - Bu mesaj

🤖 Bot 24/7 otomatik çalışıyor.
          `;
          bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
          break;
      }
      
      bot.answerCallbackQuery(query.id);
    } catch (error) {
      bot.answerCallbackQuery(query.id, { text: 'Hata oluştu' });
    }
  });

  // /status - Get current status
  bot.onText(/\/status/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    try {
      const status = await getStatusMessage();
      bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Error: ${error.message}`);
    }
  });

  // /daily - Get daily summary
  bot.onText(/\/daily/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    try {
      const summary = await getDailySummaryMessage();
      bot.sendMessage(msg.chat.id, summary, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Error: ${error.message}`);
    }
  });

  // /ai_status - Get AI weights and parameters
  bot.onText(/\/ai_status/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    try {
      const aiStatus = await getAIStatusMessage();
      bot.sendMessage(msg.chat.id, aiStatus, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Error: ${error.message}`);
    }
  });

  // /optimize - Manually trigger AI optimization
  bot.onText(/\/optimize/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    try {
      bot.sendMessage(msg.chat.id, '🧠 Running AI optimization...');
      // This will be called from main loop, so just notify
      bot.sendMessage(msg.chat.id, 'Optimization will run in next cycle');
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Error: ${error.message}`);
    }
  });

  // /flat - Emergency position close
  bot.onText(/\/flat/, async (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    try {
      const openTrades = await db.getOpenTrades();
      if (openTrades.length === 0) {
        bot.sendMessage(msg.chat.id, '✅ No open positions');
      } else {
        bot.sendMessage(msg.chat.id, 
          `⚠️ Emergency flat requested!\n${openTrades.length} position(s) marked for closure.\n\n` +
          `Bot will close positions in next iteration.`
        );
        // Set a flag that main loop can check
        global.emergencyFlat = true;
      }
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Error: ${error.message}`);
    }
  });

  // /help - Show available commands
  bot.onText(/\/help/, (msg) => {
    if (!isAuthorized(msg.from.id)) {
      bot.sendMessage(msg.chat.id, '⛔ Unauthorized');
      return;
    }
    
    const helpText = `
🤖 *Kraken AI Trading Bot - Komut Listesi*

📊 *Durum Komutları:*
/status - Pozisyon, bakiye ve PnL bilgisi
/daily - Bugünkü performans özeti

🧠 *AI Yönetimi:*
/ai\\_status - AI ağırlıkları ve parametreler
/optimize - Manuel AI optimizasyonu tetikle

🚨 *Acil Durum:*
/flat - Tüm pozisyonları acil kapat

💡 *Diğer:*
/start - Ana menüyü göster
/help - Bu yardım mesajını göster

⚙️ *Özellikler:*
✅ 24/7 Otomatik Trading
✅ AI Öğrenme Sistemi
✅ Risk Yönetimi
✅ Tek Pozisyon Kuralı
✅ Telegram Bildirimleri

📱 Komutları görmek için sol alt köşedeki menü butonunu kullanabilirsiniz.
    `;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'cmd_status' },
          { text: '📅 Daily', callback_data: 'cmd_daily' }
        ],
        [
          { text: '🧠 AI Status', callback_data: 'cmd_ai' }
        ]
      ]
    };
    
    bot.sendMessage(msg.chat.id, helpText, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });

  log('Telegram commands registered', 'INFO');
}

/**
 * Send a message via Telegram
 * @param {string} message - Message to send
 * @param {Object} options - Additional options
 * @returns {Promise<void>}
 */
export async function sendMessage(message, options = {}) {
  if (!isEnabled || !bot || !chatId) return;

  try {
    await bot.sendMessage(chatId, message, options);
  } catch (error) {
    log(`Error sending Telegram message: ${error.message}`, 'ERROR');
  }
}

/**
 * Send trade notification
 * @param {string} action - 'BUY' or 'SELL'
 * @param {Object} trade - Trade data
 * @returns {Promise<void>}
 */
export async function notifyTrade(action, trade) {
  const emoji = action === 'BUY' ? '🟢' : '🔴';
  const message = `
${emoji} *${action}* Signal

Symbol: ${trade.symbol}
Price: ${formatNumber(trade.entry_price, 2)} CAD
Quantity: ${formatNumber(trade.qty, 6)}
Confidence: ${formatNumber(trade.ai_confidence * 100, 1)}%

Stop Loss: ${formatNumber(trade.stop_loss, 2)} CAD
Take Profit: ${formatNumber(trade.take_profit, 2)} CAD
ATR: ${formatNumber(trade.atr_pct, 2)}%
  `.trim();

  await sendMessage(message, { parse_mode: 'Markdown' });
}

/**
 * Send trade close notification
 * @param {Object} trade - Closed trade data
 * @returns {Promise<void>}
 */
export async function notifyTradeClose(trade) {
  const isProfit = trade.pnl > 0;
  const emoji = isProfit ? '✅' : '❌';
  const pnlSign = trade.pnl >= 0 ? '+' : '';
  
  // Tek satırda NetPnL gösterimi (sadeleştirilmiş)
  const netPnLMessage = `Net PnL: ${pnlSign}${formatNumber(trade.pnl, 2)} CAD (${pnlSign}${formatNumber(trade.pnl_pct, 2)}%)`;
  
  const message = `
${emoji} *Position Closed*

${trade.symbol}
Entry: ${formatNumber(trade.entry_price, 2)} CAD
Exit: ${formatNumber(trade.exit_price, 2)} CAD
${netPnLMessage}
Fees: ${formatNumber(trade.total_fees || 0, 4)} CAD
Reason: ${trade.exit_reason || 'MANUAL'}

Duration: ${calculateDuration(trade.opened_at, trade.closed_at)}
  `.trim();

  // Send without parse_mode to avoid Markdown errors
  await sendMessage(message);
}

/**
 * Send daily summary notification
 * @returns {Promise<void>}
 */
export async function notifyDailySummary() {
  try {
    const summary = await getDailySummaryMessage();
    await sendMessage(`📊 *Daily Summary*\n\n${summary}`, { parse_mode: 'Markdown' });
  } catch (error) {
    log(`Error sending daily summary: ${error.message}`, 'ERROR');
  }
}

/**
 * Send error notification
 * @param {string} errorMessage - Error message
 * @returns {Promise<void>}
 */
export async function notifyError(errorMessage) {
  await sendMessage(`⚠️ *Error*\n\n${errorMessage}`, { parse_mode: 'Markdown' });
}

/**
 * Get status message with balance information
 * @returns {Promise<string>} Status message
 */
async function getStatusMessage() {
  const openTrades = await db.getOpenTrades();
  const todayPnL = await db.getTodayPnL();
  const todayTradesCount = await db.getTodayClosedTradesCount();
  
  // Get CAD balance from exchange
  let cadBalance = { free: 0, used: 0, total: 0 };
  let balanceError = false;
  try {
    const exchangeModule = await import('./exchange.js');
    cadBalance = await exchangeModule.getBalance('CAD');
  } catch (error) {
    balanceError = true;
  }

  let message = `🤖 *Bot Status*\n\n`;
  
  // CAD Balance section
  message += `💰 *CAD Balance*\n`;
  if (balanceError) {
    message += `⚠️ Unable to fetch balance\n\n`;
  } else {
    message += `Available: ${formatNumber(cadBalance.free, 2)} CAD\n`;
    message += `In Orders: ${formatNumber(cadBalance.used, 2)} CAD\n`;
    message += `Total: ${formatNumber(cadBalance.total, 2)} CAD\n\n`;
  }
  
  // Today's performance
  message += `📊 *Today's Performance*\n`;
  message += `PnL: ${formatNumber(todayPnL, 2)} CAD\n`;
  message += `Trades: ${todayTradesCount}\n\n`;

  // Open positions
  if (openTrades.length === 0) {
    message += `✅ *No Open Positions*`;
  } else {
    message += `📈 *Open Positions: ${openTrades.length}*\n\n`;
    for (const trade of openTrades) {
      const currentValue = trade.qty * trade.entry_price;
      message += `${trade.symbol}\n`;
      message += `  Entry: ${formatNumber(trade.entry_price, 2)} CAD\n`;
      message += `  Qty: ${formatNumber(trade.qty, 6)}\n`;
      message += `  Value: ${formatNumber(currentValue, 2)} CAD\n`;
      message += `  SL: ${formatNumber(trade.stop_loss, 2)} CAD\n`;
      message += `  TP: ${formatNumber(trade.take_profit, 2)} CAD\n`;
      message += `  Opened: ${formatTime(trade.opened_at)}\n\n`;
    }
  }

  return message;
}

/**
 * Get daily summary message with detailed stats
 * @returns {Promise<string>} Daily summary message
 */
async function getDailySummaryMessage() {
  const today = getCurrentDate();
  const summary = await db.getDailySummary(today);

  if (!summary || summary.trades === 0) {
    return `📅 *${today}*\n\n✅ Henüz trade yok`;
  }

  const winRate = (parseFloat(summary.win_rate) * 100).toFixed(1);
  const profitFactor = parseFloat(summary.profit_factor).toFixed(2);
  const netPnl = parseFloat(summary.net_pnl);
  const emoji = netPnl >= 0 ? '💚' : '❤️';

  let message = `📅 *Günlük Rapor: ${today}*\n\n`;
  
  // Trade summary
  message += `📊 *İşlem Özeti*\n`;
  message += `Toplam: ${summary.trades} trade\n`;
  message += `✅ Kazanan: ${summary.wins}\n`;
  message += `❌ Kaybeden: ${summary.losses}\n`;
  message += `Win Rate: ${winRate}%\n`;
  message += `Profit Factor: ${profitFactor}\n\n`;
  
  // PnL details
  message += `${emoji} *Kar/Zarar Detayı*\n`;
  message += `Net PnL: ${formatNumber(netPnl, 2)} CAD\n`;
  message += `Brüt Kar: ${formatNumber(summary.gross_profit, 2)} CAD\n`;
  message += `Brüt Zarar: ${formatNumber(summary.gross_loss, 2)} CAD\n\n`;
  
  // Averages
  message += `📈 *Ortalamalar*\n`;
  message += `Ortalama Kazanç: ${formatNumber(summary.avg_win, 2)} CAD\n`;
  message += `Ortalama Kayıp: ${formatNumber(summary.avg_loss, 2)} CAD\n`;
  message += `Max Drawdown: ${formatNumber(summary.max_drawdown, 2)} CAD`;

  return message;
}

/**
 * Get AI status message with complete parameters
 * @returns {Promise<string>} AI status message
 */
async function getAIStatusMessage() {
  const aiStatus = await ai.getAIStatus();
  const weights = aiStatus.current;
  
  // Load runtime config for multipliers
  let runtimeConfig;
  try {
    runtimeConfig = await ai.loadRuntimeConfig();
  } catch (error) {
    runtimeConfig = { tp_multiplier: 2.4, sl_multiplier: 1.2 };
  }

  let message = `🧠 *AI Status*\n\n`;
  
  // AI Weights (Self-Learning Mode)
  message += `RSI: ${weights.w_rsi.toFixed(2)}\n`;
  message += `EMA: ${weights.w_ema.toFixed(2)}\n`;
  message += `ATR: ${weights.w_atr.toFixed(2)}\n`;
  message += `VOL: ${weights.w_vol.toFixed(2)}\n\n`;
  
  // Runtime Config
  message += `RSI Range: ${runtimeConfig.rsi_oversold} / ${runtimeConfig.rsi_overbought}\n`;
  message += `TP: ${runtimeConfig.tp_multiplier}x, SL: ${runtimeConfig.sl_multiplier}x\n`;
  message += `Last Optimized: ${runtimeConfig.last_optimized ?? 'Never'}\n\n`;
  
  // Adaptive Parameters
  message += `🧠 *Adaptive Scalper Mode*\n`;
  const strat = global.botState?.strategy;
  const adaptiveFlag = strat?.adaptiveMode || (typeof strat?.confidenceThreshold !== 'undefined' ? 'ON' : 'OFF');
  message += `Adaptive: *${adaptiveFlag}*\n`;
  message += `ATR Low PCT: ${typeof strat?.atrLowPct === 'number' ? strat.atrLowPct.toFixed(3) : 'N/A'}\n`;
  message += `Confidence Threshold: ${typeof strat?.confidenceThreshold === 'number' ? strat.confidenceThreshold.toFixed(3) : 'N/A'}\n`;
  if (typeof strat?.confidenceThreshold === 'number') {
    message += `Mode: ${strat.confidenceThreshold <= 0.3 ? 'Low-Vol Scalper' : 'High-Vol Conservative'}\n\n`;
  } else {
    message += `Mode: N/A\n\n`;
  }
  
  // Risk Parameters
  message += `🎯 *Risk Yönetimi*\n`;
  message += `Stop Loss: ${runtimeConfig.sl_multiplier}× ATR\n`;
  message += `Take Profit: ${runtimeConfig.tp_multiplier}× ATR\n`;
  message += `Risk/Reward: 1:${(runtimeConfig.tp_multiplier / runtimeConfig.sl_multiplier).toFixed(2)}\n\n`;

  // Last update
  if (aiStatus.history.length > 0) {
    message += `🕐 Son Güncelleme: ${formatTime(aiStatus.history[0].timestamp)}`;
  } else {
    message += `🕐 Son Güncelleme: -`;
  }

  return message;
}

/**
 * Calculate duration between two dates
 * @param {Date} start - Start date
 * @param {Date} end - End date
 * @returns {string} Duration string
 */
function calculateDuration(start, end) {
  const diffMs = new Date(end) - new Date(start);
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Format timestamp
 * @param {Date} timestamp - Timestamp
 * @returns {string} Formatted time
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-CA', { 
    timeZone: 'America/Toronto',
    hour12: false 
  });
}

/**
 * Send heartbeat status message
 * @param {Object} botState - Bot state object
 * @param {string} status - "ok" or "error"
 * @returns {Promise<void>}
 */
export async function sendHeartbeat(botState, status) {
  try {
    const strat = botState.strategy || {};
    const params = botState.currentParams || {};
    const stats = botState.dailyStats || {};

    const adaptive = strat.adaptiveMode || "OFF";
    const pnl = stats.realizedPnL || 0;
    const trades = stats.tradesCount || 0;
    const maxTrades = params.MAX_DAILY_TRADES || 10;
    const rsiLow = params.RSI_OVERSOLD || 35;
    const rsiHigh = params.RSI_OVERBOUGHT || 65;
    const lastTrade = botState.lastTradeTime
      ? new Date(botState.lastTradeTime).toLocaleString("tr-TR")
      : "Henüz işlem yok";

    let msg = "";
    if (status === "ok") {
      msg += "🤖 *Kraken AI Trader – Durum Bildirimi*\n";
      msg += "✅ Bot çalışıyor (loop aktif)\n";
    } else {
      msg += "⚠️ *Kraken AI Trader – Uyarı*\n";
      msg += "🚨 Bot 5 dakikadır loop güncellemesi yapmadı!\n";
    }

    msg += `⏱ Son işlem: ${lastTrade}\n`;
    msg += `📊 Günlük PnL: ${pnl.toFixed(2)} CAD\n`;
    msg += `🧠 Adaptive: ${adaptive} | RSI ${rsiLow}/${rsiHigh}\n`;
    msg += `🔄 İşlemler: ${trades}/${maxTrades}\n`;
    msg += `🕒 Zaman: ${new Date().toLocaleString("tr-TR")}`;

    await sendMessage(msg, { parse_mode: 'Markdown' });
    
    // Optional: Check for 2-hour trade warning
    if (status === "ok" && botState.lastTradeTime) {
      const now = Date.now();
      const lastTradeTime = new Date(botState.lastTradeTime).getTime();
      const hoursSinceLastTrade = (now - lastTradeTime) / (1000 * 60 * 60);
      
      if (hoursSinceLastTrade >= 2) {
        await sendMessage(
          "⚠️ 2 saattir trade yapılmadı, piyasa çok sakin olabilir veya AI bekleme modunda.",
          { parse_mode: 'Markdown' }
        );
      }
    }
    
  } catch (error) {
    log(`Error sending heartbeat: ${error.message}`, 'ERROR');
  }
}

/**
 * Stop Telegram bot
 * @returns {Promise<void>}
 */
export async function stopTelegram() {
  if (bot) {
    await bot.stopPolling();
    log('Telegram bot stopped', 'INFO');
  }
}

/**
 * Check if Telegram is enabled
 * @returns {boolean}
 */
export function isReady() {
  return isEnabled && bot !== null;
}

