/**
 * Kraken AI Trading Bot - Main Entry Point
 * Fully automated, AI-learning trading bot for Kraken CAD spot markets
 * Enhanced with: single position rule, day reset, dry-run mode, trailing stop
 */

import 'dotenv/config';
import { log, sleep, getCurrentDate } from './utils.js';
import * as db from './db.js';
import * as exchange from './exchange.js';
import * as strategy from './strategy.js';
import * as ai from './ai.js';
import * as telegram from './telegram.js';
import { getState, setState, getSymbolState, setSymbolState, isTradingAllowed, updateSymbolDailyStats, resetDailyStats, getUptime } from './stateManager.js';

// Dust Management Thresholds - Standardized
const DUST_THRESHOLDS = {
  PNL_ADJUSTMENT: 0.00001,      // BTC threshold for PnL adjustment
  IMMEDIATE_CLEANUP: 0.0001,    // BTC threshold for immediate cleanup
  FORCE_CLEANUP: 0.000001,      // BTC threshold for force cleanup
  SCHEDULED_CLEANUP: 2.0,       // CAD threshold for scheduled cleanup
  MINIMUM_VALUE: 0.001          // Minimum CAD value to avoid errors
};

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection at: ${promise}, reason: ${reason}`, 'ERROR');
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, 'ERROR');
  console.error('Uncaught Exception:', error);
  
  // Graceful shutdown
  gracefulShutdown();
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down gracefully...', 'INFO');
  gracefulShutdown();
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down gracefully...', 'INFO');
  gracefulShutdown();
});

/**
 * Graceful shutdown function
 */
async function gracefulShutdown() {
  try {
    log('🛑 Shutting down bot...', 'INFO');
    setState('isRunning', false);
    
    // Close any open positions if needed
    if (botState.openPositions.size > 0) {
      log(`Closing ${botState.openPositions.size} open positions...`, 'WARN');
      // Note: In production, you might want to close positions or leave them open
    }
    
    // Send final heartbeat
    await telegram.sendHeartbeat(botState, 'shutdown');
    
    log('✅ Bot shutdown complete', 'SUCCESS');
    process.exit(0);
  } catch (error) {
    log(`Error during shutdown: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Get state from StateManager
let botState = getState();

// Make botState globally accessible for Telegram commands (backward compatibility)
global.botState = botState;

/**
 * Fee estimation fallback system
 * @param {number} orderValue - Order value in CAD
 * @param {number} feeRate - Fee rate (default: 0.0026 for Kraken taker)
 * @returns {number} Estimated fee
 */
function estimateFee(orderValue, feeRate = null) {
  const rate = feeRate || botState.feeRates?.taker || 0.0026;
  return orderValue * rate;
}

/**
 * Fee-Aware Risk Filter
 * Checks if expected net profit after fees would be positive
 * @param {Object} signal - Trading signal
 * @param {number} tradeValue - Trade value in CAD
 * @param {Object} params - Strategy parameters
 * @returns {Object} {allowed: boolean, expectedProfit: number, expectedFee: number, reason: string}
 */
function checkFeeAwareRisk(signal, tradeValue, params) {
  try {
    // Get current fee rates
    const feeRate = botState.feeRates?.taker || 0.0026;
    
    // Calculate expected fees (entry + exit)
    const expectedFee = tradeValue * feeRate * 2; // 2x for round trip
    
    // Calculate expected profit based on ATR and TP multiplier
    const atrValue = signal.atr || 0;
    const tpMultiplier = params.TP_MULTIPLIER || 2.4;
    const expectedProfit = atrValue * tpMultiplier * tradeValue;
    
    // Calculate net expected profit
    const netExpectedProfit = expectedProfit - expectedFee;
    
    // Check if net profit is positive
    const allowed = netExpectedProfit > 0;
    
    // Adaptive mode: stricter filtering for low volatility
    let reason = '';
    if (!allowed) {
      reason = `Trade avoided due to low expected profit (ATR too small or fee too high)`;
    }
    
    // Enhanced adaptive filtering for low volatility
    if (botState.strategy?.adaptiveMode === 'ON' && signal.indicators?.atrPct < 0.1) {
      const minExpectedProfit = expectedFee * 1.2; // 20% buffer above fees
      if (expectedProfit < minExpectedProfit) {
        reason = `Low volatility trade skipped - insufficient profit buffer (${expectedProfit.toFixed(2)} < ${minExpectedProfit.toFixed(2)} CAD)`;
        return {
          allowed: false,
          expectedProfit,
          expectedFee,
          netExpectedProfit,
          reason
        };
      }
    }
    
    return {
      allowed,
      expectedProfit,
      expectedFee,
      netExpectedProfit,
      reason
    };
    
  } catch (error) {
    log(`Error in fee-aware risk check: ${error.message}`, 'ERROR');
    return {
      allowed: true, // Default to allow if check fails
      expectedProfit: 0,
      expectedFee: 0,
      netExpectedProfit: 0,
      reason: 'Risk check failed, allowing trade'
    };
  }
}

/**
 * Calculate net PnL with fee-aware logic
 * @param {Object} position - Position object
 * @param {number} exitPrice - Exit price
 * @param {number} exitFee - Exit fee
 * @returns {Object} Net PnL calculation
 */
function calculateNetPnL(position, exitPrice, exitFee) {
  const grossExitValue = position.qty * exitPrice;
  const entryCost = position.qty * position.entry_price;
  const entryFee = position.entry_fee || 0;
  
  // Fee-aware net calculations
  const grossPnL = grossExitValue - entryCost;
  const totalFees = entryFee + exitFee;
  let netPnL = grossPnL - totalFees;
  let netPnLPct = entryCost > 0 ? (netPnL / entryCost) * 100 : 0;
  
  // PnL rounding: küçük oynaklıkları sıfırla (spam log önleme)
  if (Math.abs(netPnL) < 0.001) netPnL = 0;
  if (Math.abs(netPnLPct) < 0.01) netPnLPct = 0;
  
  return {
    grossPnL,
    netPnL,
    netPnLPct,
    totalFees,
    grossExitValue,
    entryCost
  };
}

/**
 * AUTO CLEANUP ORPHANED POSITIONS
 * Kraken cüzdan bakiyelerini kontrol edip orphaned pozisyonları otomatik satar
 */
async function autoSyncOrphanedPositions() {
  try {
    log('🔍 Checking for orphaned positions...', 'INFO');
    
    // Kraken cüzdan bakiyelerini oku
    const balances = await exchange.getAllBaseBalances();
    const openPositions = await db.getOpenTrades();
    
    if (!balances) {
      log('⚠️ Could not fetch balances', 'WARN');
      return;
    }
    
    let cleanupCount = 0;
    
    // Her coin için kontrol et
    for (const [asset, balance] of Object.entries(balances)) {
      if (balance.total > 0.000001) {
        // Bu asset için açık pozisyon var mı kontrol et
        const hasOpenPosition = openPositions.some(pos => 
          pos.symbol.includes(asset) && pos.closed_at === null
        );
        
        if (!hasOpenPosition) {
          log(`⚠️ Orphaned ${asset} detected: ${balance.total.toFixed(8)}`, 'WARN');
          
          // Minimum satış miktarı kontrolü
          const minSellAmount = await getMinSellAmount(`${asset}/CAD`);
          
          if (balance.total >= minSellAmount) {
            // ENABLE_TRADING kontrolü
            if (botState.tradingEnabled && !botState.dryRun) {
              try {
                // Market order ile CAD'e sat
                const sellOrder = await exchange.marketSell(`${asset}/CAD`, balance.total);
                
                const sellPrice = sellOrder.average || sellOrder.price;
                const cadValue = balance.total * sellPrice;
                
                // positions_history tablosuna kaydet
                await db.insertTrade({
                  symbol: `${asset}/CAD`,
                  side: 'SELL',
                  qty: balance.total,
                  price: sellPrice,
                  opened_at: new Date(),
                  closed_at: new Date(),
                  exit_reason: 'AUTO_CLEANUP',
                  source: 'orphan_cleanup',
                  pnl: 0, // Orphaned pozisyon için PnL yok
                  pnl_pct: 0
                });
                
                // Telegram bildirimi
                await telegram.sendMessage(
                  `💡 Auto cleanup executed\n` +
                  `${balance.total.toFixed(8)} ${asset} → ${cadValue.toFixed(2)} CAD\n` +
                  `Reason: Orphaned position`
                );
                
                log(`✅ Orphaned ${asset} sold: ${balance.total.toFixed(8)} → ${cadValue.toFixed(2)} CAD`, 'SUCCESS');
                cleanupCount++;
                
              } catch (sellError) {
                log(`❌ Failed to sell orphaned ${asset}: ${sellError.message}`, 'ERROR');
              }
            } else {
              log(`⚠️ Trading disabled, orphaned ${asset} not sold`, 'WARN');
            }
          } else {
            // === 🔧 DUST THRESHOLD OVERRIDE ===
            // If balance is below minSellAmount but still significant dust, force sell
            if (balance.total < minSellAmount && balance.total > DUST_THRESHOLDS.FORCE_CLEANUP) {
              log(`💨 Forcing tiny dust sale: ${balance.total.toFixed(8)} ${asset} (below min ${minSellAmount})`, 'INFO');
              
              if (botState.tradingEnabled && !botState.dryRun) {
                try {
                  // Force sell tiny dust even if below minimum
                  const sellOrder = await exchange.marketSell(`${asset}/CAD`, balance.total);
                  
                  const sellPrice = sellOrder.average || sellOrder.price;
                  const cadValue = balance.total * sellPrice;
                  
                  // positions_history tablosuna kaydet
                  await db.insertTrade({
                    symbol: `${asset}/CAD`,
                    side: 'SELL',
                    qty: balance.total,
                    price: sellPrice,
                    opened_at: new Date(),
                    closed_at: new Date(),
                    exit_reason: 'DUST_FORCE_CLEANUP',
                    source: 'dust_override',
                    pnl: 0,
                    pnl_pct: 0
                  });
                  
                  // Telegram bildirimi
                  await telegram.sendMessage(
                    `💨 *Dust Force Cleanup*\n\n` +
                    `${balance.total.toFixed(8)} ${asset} → ${cadValue.toFixed(2)} CAD\n` +
                    `Reason: Below minimum but significant dust\n` +
                    `Threshold override applied`,
                    { parse_mode: 'Markdown' }
                  );
                  
                  log(`✅ Tiny dust ${asset} force-sold: ${balance.total.toFixed(8)} → ${cadValue.toFixed(2)} CAD`, 'SUCCESS');
                  cleanupCount++;
                  
                } catch (dustError) {
                  log(`⚠️ Dust force sale failed: ${dustError.message}`, 'WARN');
                  // Don't throw error - dust cleanup failure shouldn't stop the process
                }
              } else {
                log(`⚠️ Trading disabled, tiny dust ${asset} not force-sold`, 'WARN');
              }
            } else {
              log(`⚠️ ${asset} amount too small to sell: ${balance.total.toFixed(8)} < ${minSellAmount}`, 'WARN');
            }
          }
        }
      }
    }
    
    log(`✅ Orphan sync complete. Cleaned up ${cleanupCount} positions.`, 'SUCCESS');
    
  } catch (error) {
    log(`❌ Error in autoSyncOrphanedPositions: ${error.message}`, 'ERROR');
  }
}

/**
 * Get minimum sell amount for a symbol
 */
async function getMinSellAmount(symbol) {
  try {
    const market = await exchange.getMarketInfo(symbol);
    return market.limits?.amount?.min || 0.00002; // Default minimum
  } catch (error) {
    return 0.00002; // Fallback minimum
  }
}

/**
 * === 🧠 Adaptive Scalper Mode ===
 * Dinamik olarak ATR ve Confidence değerlerini piyasa volatilitesine göre ayarlar.
 * @param {number} avgATR - Ortalama ATR değeri (% olarak)
 * @param {object} botState - Botun mevcut durumu (state)
 */
function adaptScalperParams(indicators, botState) {
  // Use normalized ATR% (average over last 10 candles)
  const avgATR = indicators.ATR_PCT || 0;
  
  log(`🔍 DEBUG: adaptScalperParams called with ATR_PCT=${avgATR}, botState=${!!botState}`, 'DEBUG');
  
  const baseATR = 0.1; // referans volatilite (%)
  const baseConf = 0.30;
  const baseATRLow = 0.01;

  let adaptiveConfidence = baseConf;
  let adaptiveATRLow = baseATRLow;

  // Volatilite düşükse (örnek: ATR < 0.05%)
  if (avgATR < 0.05) {
    adaptiveConfidence = baseConf - 0.1; // 0.20 (daha agresif)
    adaptiveATRLow = 0.01; // 0.01 (daha agresif)
  }
  // Orta volatilite (0.05 - 0.1%)
  else if (avgATR < 0.1) {
    adaptiveConfidence = baseConf - 0.025; // 0.275
    adaptiveATRLow = 0.0075;
  }
  // Volatilite yüksekse (0.1 - 0.2%)
  else if (avgATR > 0.1 && avgATR < 0.2) {
    adaptiveConfidence = baseConf + 0.05; // 0.35
    adaptiveATRLow = 0.0125;
  }
  // Çok yüksek volatilite (örnek pump/dump)
  else if (avgATR >= 0.2) {
    adaptiveConfidence = baseConf + 0.1; // 0.4
    adaptiveATRLow = 0.02;
  }

  // Safety limits
  adaptiveConfidence = Math.max(0.2, Math.min(0.5, adaptiveConfidence));
  adaptiveATRLow = Math.max(0.001, Math.min(0.05, adaptiveATRLow));

  // RSI-based dynamic confidence bonus
  const rsi = indicators.rsi;
  if (rsi < 25 || rsi > 75) {
    adaptiveConfidence *= 0.9; // 10% daha kolay tetikleme
    log(`🔍 DEBUG: RSI bonus applied - RSI=${rsi}, confidence reduced to ${adaptiveConfidence.toFixed(3)}`, 'DEBUG');
  }

  // botState güncelle
  botState.strategy = botState.strategy || {};
  botState.strategy.confidenceThreshold = adaptiveConfidence;
  botState.strategy.atrLowPct = adaptiveATRLow;
  botState.strategy.adaptiveMode = 'ON';

  log(`🔍 DEBUG: botState.strategy updated - confidenceThreshold=${adaptiveConfidence}, atrLowPct=${adaptiveATRLow}`, 'DEBUG');
  log(`[ADAPTIVE] ATR=${avgATR.toFixed(3)}% → Confidence=${adaptiveConfidence.toFixed(3)}, ATR_LOW_PCT=${adaptiveATRLow}`, 'INFO');
}

/**
 * Initialize the bot
 */
async function initialize() {
  log('🤖 Kraken AI Trader Starting...', 'INFO');
  
  try {
    // Load environment variables
    const config = loadConfig();
    
    // Check dry-run mode
    botState.dryRun = config.DRY_RUN === true;
    if (botState.dryRun) {
      log('⚠️  DRY-RUN MODE ENABLED - No real trades will be executed', 'WARN');
    }
    
    // Initialize database
    await db.initDB({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME
    });
    
    // Initialize exchange
    await exchange.initExchange({
      apiKey: config.KRAKEN_API_KEY,
      secret: config.KRAKEN_API_SECRET
    });
    
    // Validate and normalize symbols
    const rawSymbols = config.TRADING_SYMBOLS;
    const validatedSymbols = await exchange.validateSymbols(rawSymbols);
    
    if (validatedSymbols.length === 0) {
      throw new Error('No valid trading symbols found');
    }
    
    config.TRADING_SYMBOLS = validatedSymbols;
    
    // Initialize Telegram
    if (config.ENABLE_TELEGRAM) {
      await telegram.initTelegram({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId: config.TELEGRAM_CHAT_ID,
        allowedUserIds: config.TELEGRAM_ALLOWED_USERS
      });
    }
    
    // Load AI weights
    botState.currentWeights = await ai.loadWeights();
    log(`AI weights loaded: RSI=${botState.currentWeights.w_rsi.toFixed(3)}`, 'INFO');
    
    // Load runtime config and merge with env
    botState.runtimeConfig = await ai.loadRuntimeConfig();
    
    // Set strategy parameters
    botState.currentParams = await buildParams(config, botState.runtimeConfig);
    
    // Strategy defaults to avoid "Adaptive: OFF" due to undefined on first /ai_status
    botState.strategy = {
      adaptiveMode: 'OFF',
      confidenceThreshold: config.CONFIDENCE_THRESHOLD ?? 0.65,
      atrLowPct: botState.runtimeConfig?.atr_low_pct ?? 0.01
    };
    
    botState.tradingEnabled = config.ENABLE_TRADING && !botState.dryRun;
    
    // Debug logging for trading status
    console.log('🔍 Trading Status Debug:', {
      ENABLE_TRADING: config.ENABLE_TRADING,
      DRY_RUN: botState.dryRun,
      tradingEnabled: botState.tradingEnabled,
      ENABLE_TRADING_env: process.env.ENABLE_TRADING,
      DRY_RUN_env: process.env.DRY_RUN
    });
    botState.lastOptimizationTime = Date.now();
    botState.lastMarketSummaryTime = Date.now();
    
    // Initialize daily stats
    await initializeDailyStats();
    
    // Initialize balance tracking
    await initializeBalanceTracking();
    
    // Check and migrate missing balance_before values
    await checkAndMigrateBalanceData();
    
    // Restore open positions from database
    await restoreOpenPositions();
    
    // Load fee rates from Kraken API
    try {
      const { taker, maker } = await exchange.getFeeRates();
      botState.feeRates = { taker, maker, combined: taker * 2 }; // alım + satım
      botState.lastFeeUpdate = Date.now();
      log(`💰 Fee rates loaded: Taker=${(taker*100).toFixed(2)}%, Maker=${(maker*100).toFixed(2)}%`, 'INFO');
    } catch (error) {
      log(`⚠️ Could not load fee rates: ${error.message}`, 'WARN');
      // Fallback to default rates
      botState.feeRates = { taker: 0.0026, maker: 0.0016, combined: 0.0052 };
    }
    
    log('✅ Initialization complete', 'SUCCESS');
    log(`Trading enabled: ${botState.tradingEnabled}`, 'INFO');
    log(`Symbols: ${botState.currentParams.TRADING_SYMBOLS.join(', ')}`, 'INFO');
    log(`Runtime params: RSI=${botState.runtimeConfig.rsi_oversold}/${botState.runtimeConfig.rsi_overbought}, ` +
        `ATR=${botState.runtimeConfig.atr_low_pct}-${botState.runtimeConfig.atr_high_pct}`, 'INFO');
    
    // Start heartbeat monitoring
    startHeartbeatMonitor();
    
    return true;
  } catch (error) {
    log(`Initialization failed: ${error.message}`, 'ERROR');
    console.error(error);
    await telegram.notifyError(`Initialization failed: ${error.message}`);
    return false;
  }
}

/**
 * Build parameters from config and runtime config
 */
async function buildParams(config, runtimeConfig) {
  return {
    RISK_CAD: config.RISK_CAD,
    MAX_DAILY_LOSS_CAD: config.MAX_DAILY_LOSS_CAD,
    MAX_DAILY_TRADES: config.MAX_DAILY_TRADES,
    COOLDOWN_MINUTES: config.COOLDOWN_MINUTES,
    RSI_OVERSOLD: runtimeConfig.rsi_oversold || config.RSI_OVERSOLD,
    RSI_OVERBOUGHT: runtimeConfig.rsi_overbought || config.RSI_OVERBOUGHT,
    EMA_FAST: config.EMA_FAST,
    EMA_SLOW: config.EMA_SLOW,
    EMA_REGIME: config.EMA_REGIME,
    ATR_LOW_PCT: runtimeConfig.atr_low_pct || config.ATR_LOW_PCT,
    ATR_HIGH_PCT: runtimeConfig.atr_high_pct || config.ATR_HIGH_PCT,
    VOL_Z_MIN: runtimeConfig.vol_z_min !== undefined ? runtimeConfig.vol_z_min : config.VOL_Z_MIN,
    CONFIDENCE_THRESHOLD: config.CONFIDENCE_THRESHOLD,
    AI_OPT_INTERVAL_MIN: config.AI_OPT_INTERVAL_MIN,
    AI_LEARNING_RATE: config.AI_LEARNING_RATE,
    TRADING_SYMBOLS: config.TRADING_SYMBOLS,
    TIMEFRAME: config.TIMEFRAME,
    LOOP_INTERVAL_MS: config.LOOP_INTERVAL_MS,
    TP_MULTIPLIER: runtimeConfig.tp_multiplier || 2.4,
    SL_MULTIPLIER: runtimeConfig.sl_multiplier || 1.2
  };
}

/**
 * Load configuration from environment variables
 */
function loadConfig() {
  return {
    KRAKEN_API_KEY: process.env.KRAKEN_API_KEY || '',
    KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET || '',
    TRADING_SYMBOLS: (process.env.TRADING_SYMBOLS || 'BTC/CAD').split(','),
    TIMEFRAME: process.env.TIMEFRAME || '1m',
    RISK_CAD: parseFloat(process.env.RISK_CAD || '2'),
    AUTO_SYNC_ORPHANS: process.env.AUTO_SYNC_ORPHANS === 'true',
    MAX_DAILY_LOSS_CAD: parseFloat(process.env.MAX_DAILY_LOSS_CAD || '-40'),
    MAX_DAILY_TRADES: parseInt(process.env.MAX_DAILY_TRADES || '10'),
    COOLDOWN_MINUTES: parseInt(process.env.COOLDOWN_MINUTES || '5'),
    RSI_OVERSOLD: parseInt(process.env.RSI_OVERSOLD || '38'),
    RSI_OVERBOUGHT: parseInt(process.env.RSI_OVERBOUGHT || '62'),
    EMA_FAST: parseInt(process.env.EMA_FAST || '20'),
    EMA_SLOW: parseInt(process.env.EMA_SLOW || '50'),
    EMA_REGIME: parseInt(process.env.EMA_REGIME || '200'),
    ATR_LOW_PCT: parseFloat(process.env.ATR_LOW_PCT || '0.4'),
    ATR_HIGH_PCT: parseFloat(process.env.ATR_HIGH_PCT || '2.0'),
    VOL_Z_MIN: parseFloat(process.env.VOL_Z_MIN || '0.5'),
    CONFIDENCE_THRESHOLD: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.65'),
    AI_OPT_INTERVAL_MIN: parseInt(process.env.AI_OPT_INTERVAL_MIN || '360'),
    AI_LEARNING_RATE: parseFloat(process.env.AI_LEARNING_RATE || '0.02'),
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: parseInt(process.env.DB_PORT || '3306'),
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || '',
    DB_NAME: process.env.DB_NAME || 'kraken_trader',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    TELEGRAM_ALLOWED_USERS: process.env.TELEGRAM_ALLOWED_USERS || '',
    LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS || '60000'),
    ENABLE_TRADING: process.env.ENABLE_TRADING !== 'false',
    ENABLE_TELEGRAM: process.env.ENABLE_TELEGRAM !== 'false',
    DRY_RUN: process.env.DRY_RUN === 'true'
  };
}

/**
 * Record trade with balance tracking
 * @param {Object} tradeData - Trade data to record (should include balance_before)
 * @returns {Promise<number>} Trade ID
 */
async function recordTrade(tradeData) {
  try {
    // Use provided balance_before or fetch current if missing
    const balanceBefore = tradeData.balance_before || await exchange.getRobustCADBalance();
    
    // Add balance tracking to trade data
    const tradeWithBalance = {
      ...tradeData,
      balance_before: balanceBefore
    };
    
    // Insert trade to database
    const tradeId = await db.insertTrade(tradeWithBalance);
    
    log(`📝 Trade recorded: ID=${tradeId}, Balance Before=${balanceBefore.toFixed(2)} CAD`, 'INFO');
    
    return tradeId;
    
  } catch (error) {
    log(`❌ Error recording trade: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Check and migrate missing balance data
 */
async function checkAndMigrateBalanceData() {
  try {
    log('🔍 Checking for missing balance data...', 'INFO');
    
    // Get migration statistics
    const stats = await db.getMigrationStats();
    
    log(`📊 Balance data stats: ${stats.tradesWithBalanceBefore}/${stats.totalTrades} trades have balance_before`, 'INFO');
    
    if (stats.migrationNeeded) {
      log(`🔄 Migration needed: ${stats.tradesMissingBalanceBefore} trades missing balance_before`, 'WARN');
      
      // Perform migration
      const result = await db.migrateMissingBalanceBefore();
      
      if (result.updated > 0) {
        log(`✅ Migration completed: ${result.updated} trades updated`, 'SUCCESS');
        
        // Send Telegram notification
        await telegram.sendMessage(
          `🔄 *Balance Migration Completed*\n\n` +
          `Updated: ${result.updated} trades\n` +
          `Skipped: ${result.skipped} trades\n` +
          `Errors: ${result.errors} trades\n\n` +
          `Historical balance data has been restored.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        log(`⚠️ No trades were updated during migration`, 'WARN');
      }
    } else {
      log(`✅ All trades have balance data, no migration needed`, 'SUCCESS');
    }
    
  } catch (error) {
    log(`❌ Error during balance migration check: ${error.message}`, 'ERROR');
    // Don't throw error - migration failure shouldn't stop bot initialization
  }
}

/**
 * Initialize balance tracking
 */
async function initializeBalanceTracking() {
  try {
    // Get current balance from Kraken
    const currentBalance = await exchange.getRobustCADBalance();
    
    // Try to get last recorded balance from database
    let lastRecordedBalance = null;
    try {
      const lastTrade = await db.getLastClosedTrade();
      if (lastTrade && lastTrade.balance_after !== null) {
        lastRecordedBalance = parseFloat(lastTrade.balance_after);
        log(`💰 Last recorded balance from DB: ${lastRecordedBalance.toFixed(2)} CAD`, 'INFO');
      }
    } catch (dbError) {
      log(`⚠️ Could not get last balance from DB: ${dbError.message}`, 'WARN');
    }
    
    // Use current balance as initial balance
    botState.lastRecordedBalance = currentBalance;
    
    // Log balance comparison
    if (lastRecordedBalance !== null) {
      const balanceDiff = currentBalance - lastRecordedBalance;
      log(`💰 Balance comparison: Current=${currentBalance.toFixed(2)}, Last=${lastRecordedBalance.toFixed(2)}, Diff=${balanceDiff.toFixed(2)} CAD`, 'INFO');
    } else {
      log(`💰 Initial balance tracking: ${currentBalance.toFixed(2)} CAD (no previous record)`, 'INFO');
    }
    
  } catch (error) {
    log(`⚠️ Error initializing balance tracking: ${error.message}`, 'WARN');
    botState.lastRecordedBalance = null;
  }
}

/**
 * Initialize daily stats
 */
async function initializeDailyStats() {
  const today = getCurrentDate();
  
  // Get today's PnL using net balance changes instead of calculated PnL
  const todayPnL = await db.getTodayNetBalanceChange();
  const todayCount = await db.getTodayClosedTradesCount();
  
  botState.dailyStats = {
    date: today,
    tradesCount: todayCount,
    realizedPnL: todayPnL || 0 // Use net balance change, fallback to 0
  };
  
  log(`📊 Daily stats initialized: ${todayCount} trades, Real Net PnL: ${todayPnL?.toFixed(2) || '0.00'} CAD`, 'INFO');
}

/**
 * Restore open positions from database on startup
 */
async function restoreOpenPositions() {
  try {
    const openTrades = await db.getOpenTrades();
    
    if (openTrades.length === 0) {
      log('No open positions to restore', 'INFO');
      return;
    }
    
    // Restore each open trade to botState
    for (const trade of openTrades) {
      // Parse qty with multiple fallbacks
      let qty = parseFloat(trade.qty);
      if (!qty || isNaN(qty) || qty === 0) {
        log(`⚠️  Invalid qty in DB for ${trade.symbol}: ${trade.qty}, skipping position`, 'ERROR');
        continue;
      }
      
      const position = {
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        qty: qty,
        entry_price: parseFloat(trade.entry_price),
        stop_loss: parseFloat(trade.stop_loss),
        take_profit: parseFloat(trade.take_profit),
        ai_confidence: parseFloat(trade.ai_confidence || 0),
        atr_pct: parseFloat(trade.atr_pct || 0),
        entry_fee: parseFloat(trade.entry_fee || 0),
        opened_at: new Date(trade.opened_at)
      };
      
      botState.openPositions.set(trade.symbol, position);
      log(`✅ Restored position: ${trade.symbol} - ${position.qty} BTC @ ${position.entry_price} CAD`, 'INFO');
      log(`   SL: ${position.stop_loss}, TP: ${position.take_profit}`, 'DEBUG');
    }
    
    log(`📊 Total ${openTrades.length} position(s) restored`, 'SUCCESS');
    
  } catch (error) {
    log(`Error restoring positions: ${error.message}`, 'ERROR');
  }
}

/**
 * Enhanced Dust Cleaner Module
 * Automatically converts small crypto dust to CAD every 12 hours
 * Handles all base currencies, not just BTC
 */
let lastDustCleanTime = 0;
const DUST_CLEAN_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const DUST_THRESHOLD_CAD = DUST_THRESHOLDS.SCHEDULED_CLEANUP; // Use standardized threshold

async function autoCleanDust() {
  const now = Date.now();
  
  // Only run every 12 hours
  if (now - lastDustCleanTime < DUST_CLEAN_INTERVAL) {
    return;
  }
  
  lastDustCleanTime = now;
  
  try {
    log('🧹 Running scheduled dust cleanup (12h)...', 'INFO');
    
    const balances = await exchange.getAllBaseBalances();
    let totalCleaned = 0;
    let cleanedCurrencies = [];
    
    // Check all base currencies for dust
    for (const [currency, balance] of Object.entries(balances)) {
      if (balance.total > 0) {
        try {
          // Get CAD value of this currency
          const symbol = `${currency}/CAD`;
          const ticker = await exchange.fetchTicker(symbol);
          const cadValue = balance.total * ticker.last;
          
          // If dust (< threshold), try to convert
          if (cadValue < DUST_THRESHOLD_CAD && cadValue > DUST_THRESHOLDS.MINIMUM_VALUE) {
            log(`🧹 Converting dust: ${balance.total.toFixed(8)} ${currency} (${cadValue.toFixed(2)} CAD)`, 'INFO');
            
            try {
              const result = await exchange.convert(currency, 'CAD');
              if (result) {
                totalCleaned += result.cost;
                cleanedCurrencies.push(`${result.amount.toFixed(8)} ${currency} → ${result.cost.toFixed(2)} CAD`);
                log(`✅ Dust converted: ${result.amount.toFixed(8)} ${currency} → ${result.cost.toFixed(2)} CAD`, 'SUCCESS');
              }
            } catch (convertError) {
              log(`⚠️ Failed to convert ${currency} dust: ${convertError.message}`, 'WARN');
            }
          } else if (cadValue >= DUST_THRESHOLD_CAD) {
            log(`💰 ${currency} balance too large for dust cleanup: ${balance.total.toFixed(8)} (${cadValue.toFixed(2)} CAD)`, 'DEBUG');
          }
        } catch (tickerError) {
          log(`⚠️ Could not get ticker for ${currency}/CAD: ${tickerError.message}`, 'WARN');
        }
      }
    }
    
    // Send summary notification
    if (cleanedCurrencies.length > 0) {
      const message = `🧹 *Dust Cleanup Completed*\n\n` +
        `Total converted: ${totalCleaned.toFixed(2)} CAD\n\n` +
        `Converted:\n${cleanedCurrencies.join('\n')}\n\n` +
        `_Scheduled cleanup every 12 hours_`;
      
      await telegram.sendMessage(message, { parse_mode: 'Markdown' });
      log(`✅ Dust cleanup completed: ${cleanedCurrencies.length} currencies, ${totalCleaned.toFixed(2)} CAD total`, 'SUCCESS');
    } else {
      log(`✅ Dust cleanup completed: No dust found`, 'INFO');
    }
    
  } catch (err) {
    log(`❌ Dust cleanup error: ${err.message}`, 'ERROR');
    await telegram.notifyError(`Dust cleanup failed: ${err.message}`);
  }
}

/**
 * Check and reset daily stats (UTC 00:00)
 */
async function checkDayReset() {
  const today = getCurrentDate();
  
  if (botState.dailyStats.date !== today) {
    log(`📅 Day changed: ${botState.dailyStats.date} → ${today}`, 'INFO');
    
    // === 🔧 GÜNLÜK ORPHANED POSITIONS CLEANUP ===
    // Gün sonunda orphaned pozisyonları otomatik temizle
    await autoSyncOrphanedPositions();
    await autoCleanDust();
    
    // === 🔧 GÜN SONU DENGELEME ===
    // Gün sonunda kalan BTC varsa değerini hesaplayıp günlük PnL'ye yansıt
    try {
      const balances = await exchange.getAllBaseBalances();
      const btc = balances['BTC'] || 0;
      if (btc > 0) {
        const ticker = await exchange.fetchTicker('BTC/CAD');
        const unrealized = btc * ticker.last;
        botState.dailyStats.realizedPnL -= unrealized;
        log(`📉 Gün sonu PnL düzeltmesi: -${unrealized.toFixed(2)} CAD (kalan ${btc.toFixed(8)} BTC)`, 'INFO');
        await telegram.sendMessage(`📉 Gün sonu PnL düzeltmesi: -${unrealized.toFixed(2)} CAD (kalan ${btc.toFixed(8)} BTC)`);
      }
    } catch (balanceError) {
      log(`⚠️ Error checking end-of-day balance: ${balanceError.message}`, 'WARN');
    }
    
    // Update yesterday's summary
    await db.updateDailySummary(botState.dailyStats.date);
    
    // Send daily report
    if (botState.dailyStats.tradesCount > 0) {
      await telegram.notifyDailySummary();
    }
    
    // Reset counters
    botState.dailyStats = {
      date: today,
      tradesCount: 0,
      realizedPnL: 0
    };
    
    log('Daily stats reset', 'SUCCESS');
  }
}

/**
 * Start heartbeat monitoring system
 * Sends status updates every hour and alerts if bot stops responding
 */
function startHeartbeatMonitor() {
  log('🔄 Starting heartbeat monitor (60-minute intervals)', 'INFO');
  
  setInterval(async () => {
    try {
      const now = Date.now();
      const lastLoop = botState.lastLoopTime || 0;
      const diffMinutes = (now - lastLoop) / 60000;

      if (diffMinutes < 5) {
        await telegram.sendHeartbeat(botState, "ok");
      } else {
        await telegram.sendHeartbeat(botState, "error");
      }
    } catch (error) {
      log(`Error in heartbeat monitor: ${error.message}`, 'ERROR');
    }
  }, 3600000); // 1 hour = 3600000 ms
}

/**
 * Main trading loop
 */
async function mainLoop() {
  log('🔄 Starting main trading loop...', 'INFO');
  
  while (botState.isRunning) {
    try {
      // Check day reset
      await checkDayReset();
      
      // Check for emergency flat
      if (global.emergencyFlat) {
        await handleEmergencyFlat();
        global.emergencyFlat = false;
      }
      
      // Check daily limits
      const limitsOk = checkDailyLimits();
      log(`📊 Daily stats: ${botState.dailyStats.tradesCount}/${botState.currentParams.MAX_DAILY_TRADES} trades, ` +
          `PnL: ${botState.dailyStats.realizedPnL.toFixed(2)}/${-botState.currentParams.MAX_DAILY_LOSS_CAD} CAD`, 'DEBUG');
      
      if (!limitsOk) {
        log('Daily limits reached, waiting...', 'WARN');
        await sleep(botState.currentParams.LOOP_INTERVAL_MS);
        continue;
      }
      
      // Check and update fee rates if needed (24 hours)
      await checkAndUpdateFeeRates();
      
      // Auto-clean dust (every 12 hours)
      await autoCleanDust();
      
      // Check if we need to run AI optimization
      await checkAndRunOptimization();
      
      // Check for low-risk mode activation
      const lowRiskCheck = await ai.checkLowRiskMode();
      if (lowRiskCheck.activated) {
        await telegram.sendMessage(lowRiskCheck.message, { parse_mode: 'Markdown' });
      }
      
      // Check if we need to send market summary (DISABLED - No more spam)
      // await checkAndSendMarketSummary();
      
      // Multi-symbol trading loop
      const symbols = botState.runtimeConfig?.symbols || ['BTC/CAD'];
      
      for (const symbol of symbols) {
        try {
          // Check if trading is allowed for this symbol
          if (!isTradingAllowed(symbol)) {
            log(`🚫 Trading disabled for ${symbol}`, 'WARN');
            continue;
          }
          
          // Check if we have a position for this symbol
          const hasPosition = botState.openPositions.has(symbol);
          log(`🔍 ${symbol} position check: ${hasPosition ? 'HAS POSITION' : 'NO POSITION'}`, 'DEBUG');
          
          if (hasPosition) {
            // We have a position - check exit conditions and trailing
            log(`📊 Managing ${symbol} position...`, 'DEBUG');
            await manageOpenPositions(symbol);
          } else {
            // No position - look for entry
            log(`🔎 Looking for ${symbol} entry signal...`, 'DEBUG');
            await lookForEntry(symbol);
          }
        } catch (symbolError) {
          log(`Error processing ${symbol}: ${symbolError.message}`, 'ERROR');
        }
      }
      
      // Update daily summary
      await db.updateDailySummary(getCurrentDate());
      
      // Update heartbeat timestamp
      botState.lastLoopTime = Date.now();
      
      // Wait for next iteration
      await sleep(botState.currentParams.LOOP_INTERVAL_MS);
      
    } catch (error) {
      log(`Error in main loop: ${error.message}`, 'ERROR');
      console.error(error);
      await telegram.notifyError(`Main loop error: ${error.message}`);
      await sleep(5000); // Wait 5 seconds before retrying
    }
  }
}

/**
 * Check daily limits
 */
function checkDailyLimits() {
  const { tradesCount, realizedPnL } = botState.dailyStats;
  const { MAX_DAILY_TRADES, MAX_DAILY_LOSS_CAD } = botState.currentParams;
  
  if (tradesCount >= MAX_DAILY_TRADES) {
    return false;
  }
  
  if (realizedPnL <= -MAX_DAILY_LOSS_CAD) {
    return false;
  }
  
  return true;
}

/**
 * Check and update fee rates if needed (24 hours)
 */
async function checkAndUpdateFeeRates() {
  try {
    // Check if 24 hours have passed since last update
    if (Date.now() - (botState.lastFeeUpdate || 0) > 86400000) {
      log(`🔄 Updating fee rates (24h check)...`, 'INFO');
      
      const { taker, maker } = await exchange.getFeeRates();
      const oldTaker = botState.feeRates?.taker || 0.0026;
      const oldMaker = botState.feeRates?.maker || 0.0016;
      
      botState.feeRates = { taker, maker, combined: taker * 2 };
      botState.lastFeeUpdate = Date.now();
      
      // Log if rates changed
      if (Math.abs(taker - oldTaker) > 0.0001 || Math.abs(maker - oldMaker) > 0.0001) {
        log(`💰 Fee rates updated: Taker=${(taker*100).toFixed(2)}% (was ${(oldTaker*100).toFixed(2)}%), Maker=${(maker*100).toFixed(2)}% (was ${(oldMaker*100).toFixed(2)}%)`, 'SUCCESS');
      } else {
        log(`💰 Fee rates checked: No change (Taker=${(taker*100).toFixed(2)}%, Maker=${(maker*100).toFixed(2)}%)`, 'INFO');
      }
    }
  } catch (error) {
    log(`⚠️ Error updating fee rates: ${error.message}`, 'WARN');
  }
}

/**
 * Manage open positions (exit checks + trailing)
 * @param {string} symbol - Optional symbol to manage (for multi-symbol support)
 */
async function manageOpenPositions(symbol = null) {
  // Auto-sync orphaned BTC positions (always enabled for BTC recovery)
  await autoSyncOrphanedPositions();
  
  // Safety check: if Map is empty but we have crypto, check for dust vs real orphaned balance
  if (botState.openPositions.size === 0) {
    const balances = await exchange.getAllBaseBalances();
    const btc = balances['BTC'] || 0;
    if (btc > 0 && btc < 0.00002) {
      log(`⚠️ Detected small BTC dust: ${btc.toFixed(8)} BTC (<0.00002), skipping orphan warning`, 'WARN');
      return;
    } else if (btc >= 0.00002) {
      log(`⚠️ Real orphaned balance detected: ${btc.toFixed(8)} BTC`, 'WARN');
      await autoSyncOrphanedPositions();
    }
    return;
  }
  
  // Get positions to manage (filter by symbol if specified)
  const positionsToManage = symbol ? 
    (botState.openPositions.has(symbol) ? [[symbol, botState.openPositions.get(symbol)]] : []) :
    Array.from(botState.openPositions.entries());
  
  for (const [posSymbol, position] of positionsToManage) {
    try {
      const ticker = await exchange.fetchTicker(posSymbol);
      const currentPrice = ticker.last;
      
      // Log position details for debugging
      log(`📊 Managing ${posSymbol}: qty=${position.qty}, entry=${position.entry_price}, current=${currentPrice}`, 'DEBUG');
      
      // Calculate candles elapsed
      const candlesElapsed = strategy.calculateCandlesElapsed(position.opened_at, 1);
      
      // Check exit conditions (SL/TP/Time)
      const exitCheck = strategy.checkExitConditions(position, currentPrice, candlesElapsed);
      
      if (exitCheck.hit) {
        log(`🎯 Exit triggered: ${exitCheck.reason} at ${exitCheck.exitPrice}`, 'INFO');
        await closePosition(posSymbol, exitCheck.exitPrice, exitCheck.reason);
        continue;
      }
      
      // Trailing stop logic with adaptive parameters
      const rr = strategy.calculateRiskReward(position, currentPrice);
      const newSL = strategy.calculateTrailingStop(position, currentPrice, rr, botState.currentParams);
      
      if (newSL !== null) {
        position.stop_loss = newSL;
        botState.openPositions.set(posSymbol, position);
        log(`📈 Trailing SL updated for ${posSymbol}: ${newSL.toFixed(2)} (R:R ${rr.toFixed(2)})`, 'INFO');
      }
      
    } catch (error) {
      log(`Error managing position ${posSymbol}: ${error.message}`, 'ERROR');
    }
  }
}

/**
 * Look for entry signals
 * @param {string} symbol - Optional symbol to analyze (for multi-symbol support)
 */
async function lookForEntry(symbol = null) {
  let bestSignal = null;
  let bestSymbol = null;
  
  const symbolsToAnalyze = symbol ? [symbol] : (botState.runtimeConfig?.symbols || ['BTC/CAD']);
  
  log(`📡 Scanning ${symbolsToAnalyze.length} symbols...`, 'DEBUG');
  
  // Scan symbols for best confidence
  for (const sym of symbolsToAnalyze) {
    try {
      log(`  🔎 Analyzing ${sym}...`, 'DEBUG');
      const ohlcv = await exchange.fetchOHLCV(sym, botState.currentParams.TIMEFRAME, 220);
      
      if (!ohlcv || ohlcv.length < 220) {
        log(`Insufficient data for ${sym}`, 'WARN');
        continue;
      }
      
      log(`  📊 ${sym}: Got ${ohlcv.length} candles, analyzing...`, 'DEBUG');
      
      // Calculate indicators first to get ATR
      const indicators = strategy.calculateIndicators(ohlcv);
      
      // === 🧠 Adaptive Scalper Mode ===
      // Debug: ATR değerini kontrol et
      log(`🔍 DEBUG: indicators.ATR_PCT = ${indicators?.ATR_PCT}`, 'DEBUG');
      
      // ATR hesaplandıktan hemen sonra adaptive parametreleri güncelle
      if (indicators && indicators.ATR_PCT !== undefined) {
        log(`🔍 DEBUG: Calling adaptScalperParams with ATR_PCT=${indicators.ATR_PCT}`, 'DEBUG');
        adaptScalperParams(indicators, botState);
        log(`🔍 DEBUG: After adaptScalperParams - botState.strategy = ${JSON.stringify(botState.strategy)}`, 'DEBUG');
      } else {
        log(`🔍 DEBUG: Not calling adaptScalperParams - indicators=${!!indicators}, ATR_PCT=${indicators?.ATR_PCT}`, 'DEBUG');
      }
      
      // Get symbol-specific AI weights
      const symbolState = getSymbolState(sym);
      const weights = symbolState.aiWeights || botState.currentWeights || {
        w_rsi: 0.3,
        w_ema: 0.3,
        w_atr: 0.2,
        w_vol: 0.2
      };
      
      const signal = strategy.analyzeMarket(
        ohlcv,
        botState.currentParams,
        weights,
        botState
      );
      
      // Sinyali kaydet (son 10 tanesini tut)
      if (signal) {
        botState.recentSignals.push({
          symbol: sym,
          action: signal.action,
          rsi: signal.indicators.rsi,
          confidence: signal.confidence,
          timestamp: new Date()
        });
        
        // Son 10 sinyali tut
        if (botState.recentSignals.length > 10) {
          botState.recentSignals.shift();
        }
        
        // Extreme RSI durumlarında özel bildirim
        await notifyExtremeRSI(sym, signal);
      }
      
      if (signal && signal.action === 'BUY') {
        if (!bestSignal || signal.confidence > bestSignal.confidence) {
          bestSignal = signal;
          bestSymbol = sym;
        }
      }
    } catch (error) {
      log(`Error analyzing ${sym}: ${error.message}`, 'ERROR');
    }
  }
  
  // Execute best signal if found
  if (bestSignal && bestSymbol) {
    await handleBuySignal(bestSymbol, bestSignal);
  }
}

/**
 * Handle buy signal
 */
async function handleBuySignal(symbol, signal) {
  try {
    log(`🎯 BUY signal: ${symbol} confidence=${signal.confidence.toFixed(3)}`, 'SUCCESS');
    
    // Validate trade conditions
    const validation = strategy.validateTradeConditions(
      signal,
      {
        maxDailyLoss: botState.currentParams.MAX_DAILY_LOSS_CAD,
        maxDailyTrades: botState.currentParams.MAX_DAILY_TRADES,
        cooldownMinutes: botState.currentParams.COOLDOWN_MINUTES
      },
      {
        todayPnL: botState.dailyStats.realizedPnL,
        todayTradesCount: botState.dailyStats.tradesCount,
        hasOpenPosition: botState.openPositions.size > 0,
        lastTradeTime: botState.lastTradeTime,
        lastTradePnL: botState.lastTradePnL
      },
      botState.currentParams
    );
    
    if (!validation.allowed) {
      log(`Trade blocked: ${validation.reason}`, 'WARN');
      return;
    }
    
    // Calculate SL/TP using runtime multipliers
    const { stopLoss, takeProfit } = strategy.calculateStopLossTakeProfit(
      signal.price,
      signal.atr,
      'BUY',
      botState.currentParams.SL_MULTIPLIER,
      botState.currentParams.TP_MULTIPLIER
    );
    
    // Calculate position size with fee-aware logic
    const cadToRisk = botState.currentParams.RISK_CAD;
    
    // Fee-aware calculation: dinamik fee rate kullan (Kraken API'den)
    const feeRate = botState.feeRates?.combined || 0.0052; // alım + satım toplam fee
    
    // Fee düşülmüş efektif pozisyon değeri
    const netTradeValue = cadToRisk / (1 + feeRate);
    
    log(`💰 Fee-aware calculation: RISK_CAD=${cadToRisk}, Fee Rate=${(feeRate*100).toFixed(2)}%, Net Trade Value=${netTradeValue.toFixed(2)}`, 'INFO');
    
    // === 🔍 FEE-AWARE RISK FILTER ===
    // Check if expected net profit after fees would be positive
    const riskCheck = checkFeeAwareRisk(signal, netTradeValue, botState.currentParams);
    
    if (!riskCheck.allowed) {
      log(`[SKIPPED] ${riskCheck.reason}`, 'WARN');
      log(`💰 Expected Profit: ${riskCheck.expectedProfit.toFixed(2)} CAD, Expected Fee: ${riskCheck.expectedFee.toFixed(2)} CAD, Net: ${riskCheck.netExpectedProfit.toFixed(2)} CAD`, 'WARN');
      
      // Send Telegram notification for skipped trade
      await telegram.sendMessage(
        `⚠️ *İşlem Atlandı*\n\n` +
        `Komisyon sonrası kâr potansiyeli yetersiz.\n` +
        `Beklenen Net Getiri: ${riskCheck.netExpectedProfit.toFixed(2)} CAD\n\n` +
        `📊 *Detaylar:*\n` +
        `Beklenen Kâr: ${riskCheck.expectedProfit.toFixed(2)} CAD\n` +
        `Beklenen Komisyon: ${riskCheck.expectedFee.toFixed(2)} CAD\n` +
        `ATR: ${signal.atr?.toFixed(4) || 'N/A'}\n` +
        `TP Multiplier: ${botState.currentParams.TP_MULTIPLIER}x`,
        { parse_mode: 'Markdown' }
      );
      
      return; // Skip this trade
    }
    
    log(`✅ Fee-aware risk check passed: Net Expected Profit = ${riskCheck.netExpectedProfit.toFixed(2)} CAD`, 'SUCCESS');
    
    if (botState.dryRun) {
      log(`[DRY-RUN] Would BUY ${symbol} with ${netTradeValue.toFixed(2)} CAD (net) @ ${signal.price}`, 'INFO');
      log(`[DRY-RUN] SL: ${stopLoss.toFixed(2)}, TP: ${takeProfit.toFixed(2)}`, 'INFO');
      return;
    }
    
    if (!botState.tradingEnabled) {
      log('Trading disabled, skipping execution', 'WARN');
      return;
    }
    
    // Execute market buy with fee-adjusted CAD cost
    const order = await exchange.marketBuyCost(symbol, netTradeValue);
    
    const actualQty = order.filled || 0;
    const actualPrice = order.average || signal.price;
    
    // Fee-aware entry calculation with fallback
    const rawEntryFee = order.extractedFee?.cost || 0;
    const entryFee = rawEntryFee > 0 ? rawEntryFee : estimateFee(netTradeValue);
    
    log(`💰 Fee-aware entry: Net Trade Value=${netTradeValue.toFixed(2)}, Entry Fee=${entryFee.toFixed(4)}`, 'INFO');
    
    // Validate order execution
    if (!actualQty || actualQty === 0 || !actualPrice) {
      log(`Order execution failed: qty=${actualQty}, price=${actualPrice}`, 'ERROR');
      await telegram.notifyError(`Order failed for ${symbol}: Invalid qty or price`);
      return;
    }
    
    // Create position
    const position = {
      symbol,
      side: 'BUY',
      qty: actualQty,
      entry_price: actualPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      ai_confidence: signal.confidence,
      atr_pct: signal.indicators.atrPct,
      entry_fee: entryFee,
      opened_at: new Date()
    };
    
    // Get balance before trade for consistency
    const balanceBefore = await exchange.getRobustCADBalance();
    
    // Record trade with balance tracking
    const tradeId = await recordTrade({
      ...position,
      balance_before: balanceBefore
    });
    position.id = tradeId;
    
    // Add balance_before to position object for closePosition() access
    position.balance_before = balanceBefore;
    
    // Store in bot state
    botState.openPositions.set(symbol, position);
    
    // Notify
    await telegram.notifyTrade('BUY', position);
    
    // Send explain message
    await sendExplainMessage("BUY", symbol, {
      rsi: signal.indicators.rsi,
      ema20: signal.indicators.ema20,
      ema50: signal.indicators.ema50,
      atrPct: signal.indicators.atrPct,
      entryPrice: actualPrice,
      confidence: signal.confidence,
      reason: "RSI oversold + bullish trend"
    });
    
    log(`✅ Position opened: ${symbol} ID=${tradeId} (Fee-aware: ${netTradeValue.toFixed(2)} CAD net)`, 'SUCCESS');
    
  } catch (error) {
    log(`Error handling buy signal: ${error.message}`, 'ERROR');
    await telegram.notifyError(`Failed to open position: ${error.message}`);
  }
}

/**
 * Close an open position
 */
async function closePosition(symbol, exitPrice, reason) {
  try {
    const position = botState.openPositions.get(symbol);
    if (!position) {
      log(`No open position found for ${symbol}`, 'WARN');
      return;
    }
    
    // Validate qty before closing
    if (!position.qty || position.qty <= 0 || isNaN(position.qty)) {
      log(`❌ Invalid position qty: ${position.qty}, cannot close position`, 'ERROR');
      await telegram.notifyError(`Invalid qty for ${symbol}: ${position.qty}. Position data corrupted, removing from memory.`);
      botState.openPositions.delete(symbol);
      return;
    }
    
    log(`📤 Closing position: ${symbol} @ ${exitPrice} (${reason})`, 'INFO');
    log(`   Selling: ${position.qty} BTC`, 'DEBUG');
    
    if (botState.dryRun) {
      log(`[DRY-RUN] Would SELL ${position.qty} ${symbol} @ ${exitPrice}`, 'INFO');
      botState.openPositions.delete(symbol);
      return;
    }
    
    // Execute market sell with fee-aware amount calculation
    let sellOrder;
    try {
      // Fee-aware sell amount calculation
      const feeRate = botState.feeRates?.taker || 0.0026; // %0.26 Kraken taker fee
      const sellAmount = position.qty / (1 + feeRate); // Fee'yi ekleyerek satış miktarını hesapla
      
      log(`💰 Fee-aware sell: Original qty=${position.qty.toFixed(8)}, Fee rate=${(feeRate*100).toFixed(2)}%, Sell amount=${sellAmount.toFixed(8)}`, 'INFO');
      
      sellOrder = await exchange.marketSell(symbol, sellAmount);
      
      // 1 saniye gecikme - Kraken API'nin order settled cevabını tam alması için
      await sleep(1000);
      
    } catch (sellError) {
      // Check if it's a minimum amount error
      if (sellError.message.includes('below minimum')) {
        log(`⚠️  Position too small to sell (below exchange minimum)`, 'WARN');
        await telegram.notifyError(
          `⚠️ Cannot close ${symbol} position: ${position.qty} is below exchange minimum.\n` +
          `This is orphaned dust. Manual cleanup may be needed.`
        );
        // Mark as closed in DB with special reason
        await db.updateTradeExit(position.id, {
          exit_price: exitPrice,
          exit_fee: 0,
          pnl: 0,
          pnl_pct: 0,
          closed_at: new Date(),
          exit_reason: 'DUST_ORPHANED',
          candles_held: strategy.calculateCandlesElapsed(position.opened_at, 1)
        });
        botState.openPositions.delete(symbol);
        return;
      }
      throw sellError; // Re-throw if different error
    }
    
    const actualExitPrice = sellOrder.average || exitPrice;
    
    // Fee-aware exit calculation with fallback
    const rawExitFee = sellOrder.extractedFee?.cost || 0;
    const exitFee = rawExitFee > 0 ? rawExitFee : estimateFee(position.qty * actualExitPrice);
    
    // Calculate fee-aware net PnL
    const netPnLData = calculateNetPnL(position, actualExitPrice, exitFee);
    
    log(`💰 Fee-aware exit: Gross PnL=${netPnLData.grossPnL.toFixed(2)}, Net PnL=${netPnLData.netPnL.toFixed(2)}, Total Fees=${netPnLData.totalFees.toFixed(2)}`, 'INFO');
    
    // === 🔍 REAL WALLET BALANCE TRACKING ===
    // Get current CAD balance after trade
    let balanceAfter = null;
    let balanceBefore = position.balance_before || 0; // Get from position data
    let netBalanceChange = 0;
    let correctedPnL = netPnLData.netPnL;
    
    try {
      // Güvenli balance tracking - API'nin settle olması için bekle
      await sleep(2000); // 2 saniye bekle
      balanceAfter = await exchange.getRobustCADBalance();
      
      // If balance_before is missing, try to get it from database
      if (balanceBefore <= 0) {
        try {
          const dbTrade = await db.getTradeById(position.id);
          balanceBefore = dbTrade?.balance_before || 0;
          log(`💰 Retrieved balance_before from DB: ${balanceBefore.toFixed(2)} CAD`, 'INFO');
        } catch (dbError) {
          log(`⚠️ Could not get balance_before from DB: ${dbError.message}`, 'WARN');
        }
      }
      
      // Calculate net balance change
      if (balanceBefore > 0) {
        netBalanceChange = balanceAfter - balanceBefore;
        
        // Check for false profit reports
        if (netBalanceChange < 0 && correctedPnL > 0) {
          log(`⚠️ Correcting false profit report: Actual wallet decreased by ${netBalanceChange.toFixed(2)} CAD`, 'WARN');
          correctedPnL = netBalanceChange;
          
          // Send correction notification
          await telegram.sendMessage(
            `⚠️ *PnL Düzeltmesi*\n\n` +
            `Gerçek cüzdan bakiyesi azaldı.\n` +
            `Hesaplanan PnL: ${netPnLData.netPnL.toFixed(2)} CAD\n` +
            `Gerçek Değişim: ${netBalanceChange.toFixed(2)} CAD\n` +
            `Düzeltilmiş PnL: ${correctedPnL.toFixed(2)} CAD`,
            { parse_mode: 'Markdown' }
          );
        }
        
        log(`💰 Balance tracking: Before=${balanceBefore.toFixed(2)}, After=${balanceAfter.toFixed(2)}, Change=${netBalanceChange.toFixed(2)}`, 'INFO');
      } else {
        log(`⚠️ No balance_before available for this trade, skipping balance correction`, 'WARN');
        // Use calculated PnL as fallback
        netBalanceChange = correctedPnL;
      }
    } catch (balanceError) {
      log(`⚠️ Error tracking balance: ${balanceError.message}`, 'WARN');
      // Use calculated PnL as fallback
      netBalanceChange = correctedPnL;
    }
    
    // Calculate candles held
    const candlesHeld = strategy.calculateCandlesElapsed(position.opened_at, 1);
    
    // Update database with net PnL and balance tracking
    await db.updateTradeExit(position.id, {
      exit_price: actualExitPrice,
      exit_fee: exitFee,
      pnl: netPnLData.grossPnL, // Gross PnL for compatibility
      pnl_pct: netPnLData.netPnLPct, // Net PnL percentage
      pnl_net: correctedPnL, // Corrected net PnL
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      net_balance_change: netBalanceChange,
      closed_at: new Date(),
      exit_reason: reason,
      candles_held: candlesHeld
    });
    
    // AI weights will be updated by analyzeTradeAndOptimize() below
    // (Removed duplicate learning to prevent double weight updates)
    
    // Update daily stats with CORRECTED NET BALANCE CHANGE (includes dust adjustment)
    botState.dailyStats.tradesCount++;
    botState.dailyStats.realizedPnL += correctedPnL; // Use corrected PnL that includes dust adjustment
    
    // === 🔧 SATIŞ SONRASI DENGELEME ===
    // Satıştan sonra kalan BTC varsa PnL'den düş (0.00001 üzeri için)
    try {
      const balances = await exchange.getAllBaseBalances();
      const btc = balances['BTC'] || 0;
      if (btc > DUST_THRESHOLDS.PNL_ADJUSTMENT) {
        const ticker = await exchange.fetchTicker('BTC/CAD');
        const currentPrice = ticker.last;
        const unrealizedLoss = btc * currentPrice;
        
        // PnL düzeltmesi: kalan BTC'nin değerini net PnL'den çıkar
        correctedPnL -= unrealizedLoss;
        netBalanceChange -= unrealizedLoss;
        
        log(`⚖️ PnL düzeltildi (kalan ${btc.toFixed(8)} BTC @ ${currentPrice.toFixed(2)}): -${unrealizedLoss.toFixed(2)} CAD`, 'WARN');
        log(`💰 Final corrected PnL: ${correctedPnL.toFixed(2)} CAD (includes dust adjustment)`, 'INFO');
        
        await telegram.sendMessage(
          `⚖️ *PnL Düzeltmesi*\n\n` +
          `Kalan BTC: ${btc.toFixed(8)} BTC\n` +
          `Fiyat: ${currentPrice.toFixed(2)} CAD\n` +
          `Düzeltme: -${unrealizedLoss.toFixed(2)} CAD\n\n` +
          `Final PnL: ${correctedPnL.toFixed(2)} CAD`,
          { parse_mode: 'Markdown' }
        );
      } else if (btc > 0 && btc <= DUST_THRESHOLDS.PNL_ADJUSTMENT) {
        log(`⚠️ Tiny BTC dust remaining: ${btc.toFixed(8)} BTC (≤${DUST_THRESHOLDS.PNL_ADJUSTMENT}), no PnL adjustment needed`, 'INFO');
      }
    } catch (balanceError) {
      log(`⚠️ Error checking post-sale balance: ${balanceError.message}`, 'WARN');
    }
    
    // Update bot state
    botState.openPositions.delete(symbol);
    botState.lastTradeTime = new Date();
    botState.lastTradePnL = netPnLData.netPnL; // Use net PnL
    
    // Notify with corrected PnL data and balance tracking
    await telegram.notifyTradeClose({
      ...position,
      exit_price: actualExitPrice,
      pnl: correctedPnL, // Use corrected PnL (includes dust adjustment)
      pnl_net: correctedPnL, // Corrected net PnL
      pnl_pct: netPnLData.netPnLPct,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      net_balance_change: correctedPnL, // Use corrected PnL
      exit_reason: reason,
      closed_at: new Date(),
      total_fees: netPnLData.totalFees
    });
    
    // Self-Learning Analysis
    try {
      const learningResult = await ai.analyzeTradeAndOptimize({
        pnl: correctedPnL, // Use corrected PnL (includes dust adjustment) for AI learning
        entry_reason: 'AI_SIGNAL',
        exit_reason: reason,
        indicators: {
          rsi: 0, // Will be updated with current indicators if available
          ema20: 0,
          ema50: 0,
          atrPct: 0
        }
      });
      
      if (learningResult) {
        // Update bot state with new weights
        botState.currentWeights = learningResult.newWeights;
        
        // Send enhanced explain message with AI learning info
        await sendEnhancedExplainMessage(symbol, {
          pnl: correctedPnL, // Use corrected PnL (includes dust adjustment)
          entryPrice: position.entry_price,
          exitPrice: actualExitPrice,
          reason: learningResult.reasonText,
          adjustment: learningResult.adjustmentText,
          newWeights: learningResult.newWeights,
          isProfit: learningResult.isProfit
        });
      } else {
        // Fallback to basic explain message
        const messageType = correctedPnL < 0 ? "LOSS" : "SELL";
        await sendExplainMessage(messageType, symbol, {
          rsi: 0,
          ema20: 0,
          ema50: 0,
          atrPct: 0,
          entryPrice: position.entry_price,
          exitPrice: actualExitPrice,
          pnl: correctedPnL, // Use corrected PnL (includes dust adjustment)
          confidence: position.ai_confidence,
          reason: reason
        });
      }
    } catch (error) {
      log(`Error in self-learning analysis: ${error.message}`, 'WARN');
      
      // Fallback to basic explain message
      const messageType = correctedPnL < 0 ? "LOSS" : "SELL";
      await sendExplainMessage(messageType, symbol, {
        rsi: 0,
        ema20: 0,
        ema50: 0,
        atrPct: 0,
        entryPrice: position.entry_price,
        exitPrice: actualExitPrice,
        pnl: correctedPnL, // Use corrected PnL (includes dust adjustment)
        confidence: position.ai_confidence,
        reason: reason
      });
    }
    
    log(`✅ Position closed: ${symbol} Corrected PnL=${correctedPnL.toFixed(2)} CAD (includes dust adjustment)`, 
        correctedPnL > 0 ? 'SUCCESS' : 'WARN');
    
    // === 🔧 AFTER SALE EXECUTED - IMMEDIATE DUST CLEANUP ===
    // Satıştan hemen sonra kalan kırıntıyı anında temizle (12 saat beklemeden)
    try {
      const balances = await exchange.getAllBaseBalances();
      const btcBalance = balances['BTC'] || 0;
      
      if (btcBalance > 0 && btcBalance < DUST_THRESHOLDS.IMMEDIATE_CLEANUP) {
        log(`🧹 Auto-cleaning tiny BTC dust after close: ${btcBalance.toFixed(8)} BTC`, 'INFO');
        
        if (botState.tradingEnabled && !botState.dryRun) {
          try {
            // Force sell tiny dust immediately after position close
            const dustSellOrder = await exchange.marketSell('BTC/CAD', btcBalance);
            
            const dustSellPrice = dustSellOrder.average || dustSellOrder.price;
            const dustCadValue = btcBalance * dustSellPrice;
            
            // Record dust cleanup trade
            await db.insertTrade({
              symbol: 'BTC/CAD',
              side: 'SELL',
              qty: btcBalance,
              price: dustSellPrice,
              opened_at: new Date(),
              closed_at: new Date(),
              exit_reason: 'IMMEDIATE_DUST_CLEANUP',
              source: 'post_close_cleanup',
              pnl: 0,
              pnl_pct: 0
            });
            
            // Telegram notification
            await telegram.sendMessage(
              `🧹 *Immediate Dust Cleanup*\n\n` +
              `Position: ${symbol}\n` +
              `Dust: ${btcBalance.toFixed(8)} BTC → ${dustCadValue.toFixed(2)} CAD\n` +
              `Reason: Post-close cleanup\n` +
              `_Cleaned immediately after position close_`,
              { parse_mode: 'Markdown' }
            );
            
            log(`✅ Immediate dust cleanup: ${btcBalance.toFixed(8)} BTC → ${dustCadValue.toFixed(2)} CAD`, 'SUCCESS');
            
          } catch (dustError) {
            log(`⚠️ Immediate dust cleanup failed: ${dustError.message}`, 'WARN');
            // Don't throw error - dust cleanup failure shouldn't affect position close
          }
        } else {
          log(`⚠️ Trading disabled, immediate dust cleanup skipped`, 'WARN');
        }
      } else if (btcBalance >= DUST_THRESHOLDS.IMMEDIATE_CLEANUP) {
        log(`💰 Significant BTC balance remaining: ${btcBalance.toFixed(8)} BTC (≥${DUST_THRESHOLDS.IMMEDIATE_CLEANUP}), no immediate cleanup needed`, 'INFO');
      }
    } catch (dustCheckError) {
      log(`⚠️ Error checking post-close dust: ${dustCheckError.message}`, 'WARN');
      // Don't throw error - dust check failure shouldn't affect position close
    }
    
  } catch (error) {
    log(`Error closing position: ${error.message}`, 'ERROR');
    await telegram.notifyError(`Failed to close position: ${error.message}`);
  }
}

/**
 * Handle emergency flat (close all positions)
 */
async function handleEmergencyFlat() {
  log('🚨 Emergency flat triggered!', 'WARN');
  
  for (const [symbol, position] of botState.openPositions) {
    try {
      const ticker = await exchange.fetchTicker(symbol);
      await closePosition(symbol, ticker.last, 'EMERGENCY_FLAT');
    } catch (error) {
      log(`Error in emergency flat for ${symbol}: ${error.message}`, 'ERROR');
    }
  }
  
  await telegram.sendMessage('✅ Emergency flat completed');
}

/**
 * Notify extreme RSI conditions (once per 10 min per symbol)
 */
const lastExtremeNotify = new Map(); // symbol -> timestamp

async function notifyExtremeRSI(symbol, signal) {
  const rsi = signal.indicators.rsi;
  
  // Extreme oversold (RSI < 20) veya extreme overbought (RSI > 80)
  if (rsi < 20 || rsi > 80) {
    const lastNotify = lastExtremeNotify.get(symbol);
    const now = Date.now();
    
    // Aynı sembol için 10 dakikada bir bildir
    if (!lastNotify || (now - lastNotify) > 600000) {
      const emoji = rsi < 20 ? '🔥' : '⚠️';
      const condition = rsi < 20 ? 'EXTREME OVERSOLD' : 'EXTREME OVERBOUGHT';
      
      await telegram.sendMessage(
        `${emoji} *${condition}*\n\n` +
        `Symbol: ${symbol}\n` +
        `RSI: ${rsi.toFixed(1)}\n` +
        `Action: ${signal.action || 'NONE'}\n` +
        `Confidence: ${(signal.confidence * 100).toFixed(1)}%`,
        { parse_mode: 'Markdown' }
      );
      
      lastExtremeNotify.set(symbol, now);
    }
  }
}

/**
 * Send enhanced explain message with AI learning info
 * @param {string} symbol - Trading symbol
 * @param {Object} data - Trade data with AI learning results
 */
async function sendEnhancedExplainMessage(symbol, data) {
  const { pnl, entryPrice, exitPrice, reason, adjustment, newWeights, isProfit } = data;
  const emoji = isProfit ? '✅' : '⚠️';
  const result = isProfit ? 'PROFIT' : 'LOSS';
  const pnlSign = pnl >= 0 ? '+' : '';
  
  const message = `
${emoji} *TRADE CLOSED — ${result}*

PnL: ${pnlSign}${pnl.toFixed(2)} CAD

📊 *Reason:* ${reason}

🤖 *Adjustment:* ${adjustment}

🧠 *AI Weights Updated →*
RSI ${newWeights.w_rsi.toFixed(2)}, EMA ${newWeights.w_ema.toFixed(2)}, ATR ${newWeights.w_atr.toFixed(2)}, VOL ${newWeights.w_vol.toFixed(2)}
  `.trim();

  try {
    await telegram.sendMessage(message, { parse_mode: "Markdown" });
  } catch (err) {
    log(`Telegram enhanced explain message failed: ${err.message}`, 'ERROR');
  }
}

/**
 * Send explain message for trade actions
 * @param {string} type - BUY, SELL, or LOSS
 * @param {string} symbol - Trading symbol
 * @param {Object} data - Trade data and indicators
 */
async function sendExplainMessage(type, symbol, data) {
  const { rsi, ema20, ema50, atrPct, pnl, reason, confidence, entryPrice, exitPrice } = data;
  let message = "";

  if (type === "BUY") {
    message = `
🟢 *BUY EXECUTED* (${symbol})
Price: ${entryPrice.toFixed(2)} CAD
Confidence: ${(confidence * 100).toFixed(1)}%

📊 *Reason:*
RSI (${rsi.toFixed(1)}) → Oversold
EMA20 (${ema20.toFixed(2)}) > EMA50 (${ema50.toFixed(2)}) → Bullish trend
ATR = ${(atrPct * 100).toFixed(2)}% → Normal volatility

🤖 *Decision:*
AI, düşük RSI ve yükselen trend kombinasyonu nedeniyle alım yaptı.
    `;
  } else if (type === "SELL") {
    const pnlPct = entryPrice > 0 ? ((pnl / entryPrice) * 100) : 0;
    message = `
🔴 *SELL EXECUTED* (${symbol})
Entry: ${entryPrice.toFixed(2)} → Exit: ${exitPrice.toFixed(2)}
PnL: ${pnl.toFixed(2)} CAD (${pnlPct.toFixed(2)}%)

📊 *Reason:*
RSI (${rsi.toFixed(1)}) → ${rsi > 65 ? 'Overbought' : 'Normal'}
Trend momentum zayıfladı (EMA20 < EMA50)

🤖 *Decision:*
Kâr alımı yapıldı — momentum zayıfladığı için pozisyon kapatıldı.
    `;
  } else if (type === "LOSS") {
    message = `
⚠️ *TRADE CLOSED — LOSS*

PnL: ${pnl.toFixed(2)} CAD

📊 *Reason:*
EMA kırıldı, RSI toparlanamadı (${rsi.toFixed(1)}).  
Stop-loss tetiklendi, fiyat momentum kaybetti.

🤖 *Adjustment:*
AI, sonraki optimizasyonda RSI ağırlığını %1 azaltacak.
    `;
  }

  try {
    await telegram.sendMessage(message, { parse_mode: "Markdown" });
  } catch (err) {
    log(`Telegram explain message failed: ${err.message}`, 'ERROR');
  }
}

/**
 * Check and send market summary (DISABLED - No more spam)
 */
async function checkAndSendMarketSummary() {
  const now = Date.now();
  const timeSinceLastSummary = (now - botState.lastMarketSummaryTime) / 1000 / 60; // minutes
  
  if (timeSinceLastSummary >= 10) {
    try {
      await sendMarketSummary();
      botState.lastMarketSummaryTime = now;
    } catch (error) {
      log(`Error sending market summary: ${error.message}`, 'ERROR');
    }
  }
}

/**
 * Send market summary to Telegram (DISABLED - No more spam)
 */
async function sendMarketSummary() {
  // DISABLED: No more market summary spam
  return;
  
  /* DISABLED CODE - Keeping for reference
  if (botState.recentSignals.length === 0) return;
  
  // Son 5 sinyali al
  const recent5 = botState.recentSignals.slice(-5);
  
  let message = `📊 *Market Summary*\n\n`;
  
  for (const sig of recent5) {
    const emoji = sig.action === 'BUY' ? '🟢' : sig.rsi > 70 ? '🔴' : '⚪';
    const rsiColor = sig.rsi < 30 ? '🔥' : sig.rsi > 70 ? '⚠️' : '';
    message += `${emoji} ${sig.symbol}\n`;
    message += `  RSI: ${sig.rsi.toFixed(1)} ${rsiColor}\n`;
    message += `  Action: ${sig.action || 'NONE'}\n`;
    message += `  Conf: ${(sig.confidence * 100).toFixed(0)}%\n\n`;
  }
  
  message += `_Son 5 sinyal (10dk rapor)_`;
  
  await telegram.sendMessage(message, { parse_mode: 'Markdown' });
  */
}

/**
 * Check if AI optimization should run
 */
async function checkAndRunOptimization() {
  const now = Date.now();
  const timeSinceLastOpt = (now - botState.lastOptimizationTime) / 1000 / 60; // minutes
  
  if (timeSinceLastOpt >= botState.currentParams.AI_OPT_INTERVAL_MIN) {
    log('🧠 Running AI optimization cycle...', 'INFO');
    
    try {
      const result = await ai.runOptimizationCycle(
        botState.currentWeights,
        botState.currentParams
      );
      
      // Update bot state with optimized values
      botState.currentWeights = result.weights;
      
      // Reload runtime config
      botState.runtimeConfig = await ai.loadRuntimeConfig();
      botState.currentParams = await buildParams(loadConfig(), botState.runtimeConfig);
      
      botState.lastOptimizationTime = now;
      
      await telegram.sendMessage(
        `🧠 AI optimization completed\n` +
        `RSI: ${botState.runtimeConfig.rsi_oversold}/${botState.runtimeConfig.rsi_overbought}\n` +
        `ATR: ${botState.runtimeConfig.atr_low_pct.toFixed(2)}-${botState.runtimeConfig.atr_high_pct.toFixed(2)}%\n` +
        `TP/SL: ${botState.runtimeConfig.tp_multiplier.toFixed(2)}x / ${botState.runtimeConfig.sl_multiplier.toFixed(2)}x`
      );
    } catch (error) {
      log(`Optimization error: ${error.message}`, 'ERROR');
    }
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  log('🛑 Shutting down bot...', 'INFO');
  
  botState.isRunning = false;
  
  // Update daily summary
  await db.updateDailySummary(getCurrentDate());
  
  // Close connections
  await telegram.stopTelegram();
  await db.closeDB();
  
  log('Bot stopped', 'INFO');
  process.exit(0);
}

/**
 * Main function
 */
async function main() {
  // Register signal handlers
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', async (error) => {
    log(`Uncaught exception: ${error.message}`, 'ERROR');
    console.error(error);
    await telegram.notifyError(`Uncaught exception: ${error.message}`);
    await shutdown();
  });
  
  // Initialize bot
  const initialized = await initialize();
  if (!initialized) {
    log('Failed to initialize bot', 'ERROR');
    process.exit(1);
  }
  
  // Start main loop
  botState.isRunning = true;
  await mainLoop();
}

// Start the bot
main().catch(async (error) => {
  log(`Fatal error: ${error.message}`, 'ERROR');
  console.error(error);
  await telegram.notifyError(`Fatal error: ${error.message}`);
  process.exit(1);
});
