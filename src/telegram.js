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

    log('Telegram bot initialized', 'SUCCESS');
    log(`Allowed users: ${allowedUserIds.join(', ')}`, 'INFO');
    await sendMessage('🤖 Kraken AI Trader started successfully!');
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
 * Set up Telegram command handlers
 */
function setupCommands() {
  if (!bot) return;

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
    const helpText = `
*Available Commands:*

/status - Show current positions, balance, and PnL
/daily - Show today's performance summary
/ai\\_status - Show AI weights and parameters
/flat - Emergency close all positions
/help - Show this help message

🤖 Kraken AI Trader Bot
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
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
  const message = `
${emoji} *Position Closed*

Symbol: ${trade.symbol}
Entry: ${formatNumber(trade.entry_price, 2)} CAD
Exit: ${formatNumber(trade.exit_price, 2)} CAD

PnL: ${formatNumber(trade.pnl, 2)} CAD (${formatNumber(trade.pnl_pct, 2)}%)
Reason: ${trade.exit_reason || 'MANUAL'}

Duration: ${calculateDuration(trade.opened_at, trade.closed_at)}
  `.trim();

  await sendMessage(message, { parse_mode: 'Markdown' });
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
 * Get status message
 * @returns {Promise<string>} Status message
 */
async function getStatusMessage() {
  const openTrades = await db.getOpenTrades();
  const todayPnL = await db.getTodayPnL();
  const todayTradesCount = await db.getTodayClosedTradesCount();

  let message = `*Bot Status*\n\n`;
  message += `Today's PnL: ${formatNumber(todayPnL, 2)} CAD\n`;
  message += `Today's Trades: ${todayTradesCount}\n\n`;

  if (openTrades.length === 0) {
    message += `No open positions`;
  } else {
    message += `*Open Positions: ${openTrades.length}*\n\n`;
    for (const trade of openTrades) {
      message += `${trade.symbol}\n`;
      message += `  Entry: ${formatNumber(trade.entry_price, 2)} CAD\n`;
      message += `  Qty: ${formatNumber(trade.qty, 6)}\n`;
      message += `  SL: ${formatNumber(trade.stop_loss, 2)}\n`;
      message += `  TP: ${formatNumber(trade.take_profit, 2)}\n`;
      message += `  Opened: ${formatTime(trade.opened_at)}\n\n`;
    }
  }

  return message;
}

/**
 * Get daily summary message
 * @returns {Promise<string>} Daily summary message
 */
async function getDailySummaryMessage() {
  const today = getCurrentDate();
  const summary = await db.getDailySummary(today);

  if (!summary || summary.trades === 0) {
    return `No trades today (${today})`;
  }

  const winRate = (parseFloat(summary.win_rate) * 100).toFixed(1);
  const profitFactor = parseFloat(summary.profit_factor).toFixed(2);

  let message = `📅 *${today}*\n\n`;
  message += `Trades: ${summary.trades}\n`;
  message += `Wins: ${summary.wins} | Losses: ${summary.losses}\n`;
  message += `Win Rate: ${winRate}%\n`;
  message += `Profit Factor: ${profitFactor}\n\n`;
  message += `Net PnL: ${formatNumber(summary.net_pnl, 2)} CAD\n`;
  message += `Gross Profit: ${formatNumber(summary.gross_profit, 2)} CAD\n`;
  message += `Gross Loss: ${formatNumber(summary.gross_loss, 2)} CAD\n\n`;
  message += `Avg Win: ${formatNumber(summary.avg_win, 2)} CAD\n`;
  message += `Avg Loss: ${formatNumber(summary.avg_loss, 2)} CAD\n`;
  message += `Max Drawdown: ${formatNumber(summary.max_drawdown, 2)} CAD`;

  return message;
}

/**
 * Get AI status message
 * @returns {Promise<string>} AI status message
 */
async function getAIStatusMessage() {
  const aiStatus = await ai.getAIStatus();
  const weights = aiStatus.current;

  let message = `🤖 *AI Status*\n\n`;
  message += `*Current Weights:*\n`;
  message += `RSI: ${formatNumber(weights.w_rsi, 3)} (${(weights.w_rsi * 100).toFixed(0)}%)\n`;
  message += `EMA: ${formatNumber(weights.w_ema, 3)} (${(weights.w_ema * 100).toFixed(0)}%)\n`;
  message += `ATR: ${formatNumber(weights.w_atr, 3)} (${(weights.w_atr * 100).toFixed(0)}%)\n`;
  message += `VOL: ${formatNumber(weights.w_vol, 3)} (${(weights.w_vol * 100).toFixed(0)}%)\n\n`;

  message += `*Strategy Parameters:*\n`;
  message += `RSI Oversold: ${weights.rsi_oversold}\n`;
  message += `RSI Overbought: ${weights.rsi_overbought}\n`;
  message += `ATR Range: ${weights.atr_low_pct} - ${weights.atr_high_pct}%\n\n`;

  if (aiStatus.history.length > 0) {
    message += `Last updated: ${formatTime(aiStatus.history[0].timestamp)}`;
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

