/**
 * AI Learning and Optimization Module
 * Reinforcement learning for strategy improvement
 * Enhanced with runtime-config.json for parameter persistence
 */

import * as db from './db.js';
import { log, clamp, safeDivide, getCurrentDate } from './utils.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI_WEIGHTS_FILE = path.join(__dirname, 'ai-weights.json');
const RUNTIME_CONFIG_FILE = path.join(__dirname, 'runtime-config.json');
const AI_LEARNING_LOG_FILE = path.join(__dirname, 'ai-learning.json');
const AI_MEMORY_DIR = path.join(__dirname, 'ai-memory');

/**
 * Update AI weights based on trade result (reinforcement learning)
 * @param {Object} weights - Current weights
 * @param {number} pnl - Trade PnL
 * @param {number} learningRate - Learning rate (default 0.01)
 * @returns {Object} Updated weights
 */
export function updateWeightsFromTrade(weights, pnl, learningRate = 0.01) {
  // Simple reward: +1 for profit, -1 for loss
  const reward = pnl > 0 ? 1 : -1;
  
  // Update weights with gradient ascent
  const newWeights = {
    w_rsi: weights.w_rsi + learningRate * reward,
    w_ema: weights.w_ema + learningRate * reward,
    w_atr: weights.w_atr + learningRate * reward,
    w_vol: weights.w_vol + learningRate * reward
  };
  
  // Clamp weights to reasonable range [0.3, 1.2]
  newWeights.w_rsi = clamp(newWeights.w_rsi, 0.3, 1.2);
  newWeights.w_ema = clamp(newWeights.w_ema, 0.3, 1.2);
  newWeights.w_atr = clamp(newWeights.w_atr, 0.3, 1.2);
  newWeights.w_vol = clamp(newWeights.w_vol, 0.3, 1.2);
  
  // Normalize weights to sum to 1.0
  const total = newWeights.w_rsi + newWeights.w_ema + newWeights.w_atr + newWeights.w_vol;
  newWeights.w_rsi /= total;
  newWeights.w_ema /= total;
  newWeights.w_atr /= total;
  newWeights.w_vol /= total;
  
  log(`Weights updated: RSI=${newWeights.w_rsi.toFixed(3)}, EMA=${newWeights.w_ema.toFixed(3)}, ` +
      `ATR=${newWeights.w_atr.toFixed(3)}, VOL=${newWeights.w_vol.toFixed(3)}`, 'INFO');
  
  return newWeights;
}

/**
 * Optimize strategy parameters based on performance metrics
 * Enhanced with runtime config persistence
 * @param {Object} params - Current strategy parameters
 * @param {Object} performance - Performance metrics
 * @param {number} riskPerTrade - Risk per trade in CAD
 * @returns {Object} Optimized parameters
 */
export async function optimizeParameters(params, performance, riskPerTrade = 2) {
  const newParams = { ...params };
  let changes = [];
  
  // Win rate too low: adjust RSI thresholds (make less restrictive)
  if (performance.win_rate < 0.52) {
    const currentOversold = newParams.rsi_oversold || params.RSI_OVERSOLD || 38;
    const currentOverbought = newParams.rsi_overbought || params.RSI_OVERBOUGHT || 62;
    
    newParams.rsi_oversold = Math.max(currentOversold - 1, 30); // Min 30
    newParams.rsi_overbought = Math.min(currentOverbought + 1, 70); // Max 70
    changes.push(`RSI adjusted: oversold=${newParams.rsi_oversold}, overbought=${newParams.rsi_overbought}`);
  }
  
  // Profit factor too low: increase take profit multiplier
  if (performance.profit_factor < 1.2) {
    const currentTP = newParams.tp_multiplier || 2.4;
    newParams.tp_multiplier = Math.min(currentTP * 1.1, 3.5); // Max 3.5x
    changes.push(`TP multiplier increased to ${newParams.tp_multiplier.toFixed(2)}`);
  }
  
  // Max drawdown too high: increase volatility filter (be more selective)
  const maxAcceptableDD = riskPerTrade * 8; // 8x single trade risk
  if (performance.max_drawdown > maxAcceptableDD) {
    const currentLow = newParams.atr_low_pct || params.ATR_LOW_PCT || 0.4;
    newParams.atr_low_pct = Math.min(currentLow + 0.1, 1.0); // Max 1.0%
    changes.push(`ATR low threshold increased to ${newParams.atr_low_pct.toFixed(2)}%`);
  }
  
  // Win rate too high but profit factor low: possibly taking profit too early
  if (performance.win_rate > 0.65 && performance.profit_factor < 1.5) {
    const currentTP = newParams.tp_multiplier || 2.4;
    newParams.tp_multiplier = Math.min(currentTP * 1.05, 3.5);
    changes.push(`High WR but low PF - TP increased to ${newParams.tp_multiplier.toFixed(2)}`);
  }
  
  // Average loss > average win: tighten stops
  if (performance.avg_loss > performance.avg_win && performance.avg_win > 0) {
    const currentSL = newParams.sl_multiplier || 1.2;
    newParams.sl_multiplier = Math.max(currentSL * 0.95, 0.8); // Min 0.8x
    changes.push(`SL multiplier tightened to ${newParams.sl_multiplier.toFixed(2)}`);
  }
  
  if (changes.length > 0) {
    log('🧠 Parameter optimization:', 'INFO');
    changes.forEach(change => log(`  ✓ ${change}`, 'SUCCESS'));
    
    // Save to runtime config
    await saveRuntimeConfig(newParams);
  } else {
    log('No parameter adjustments needed', 'INFO');
  }
  
  return newParams;
}

/**
 * Calculate performance metrics for optimization
 * @param {Object} dailySummary - Daily summary data
 * @param {number} riskPerTrade - Risk per trade in CAD
 * @returns {Object} Performance metrics
 */
export function calculatePerformanceMetrics(dailySummary, riskPerTrade = 2) {
  return {
    win_rate: parseFloat(dailySummary.win_rate) || 0,
    profit_factor: parseFloat(dailySummary.profit_factor) || 0,
    max_drawdown: parseFloat(dailySummary.max_drawdown) || 0,
    avg_win: parseFloat(dailySummary.avg_win) || 0,
    avg_loss: parseFloat(dailySummary.avg_loss) || 0,
    net_pnl: parseFloat(dailySummary.net_pnl) || 0,
    trades: dailySummary.trades || 0,
    avg_trade_risk: riskPerTrade
  };
}

/**
 * Run AI optimization cycle
 * @param {Object} currentWeights - Current AI weights
 * @param {Object} currentParams - Current strategy parameters
 * @returns {Promise<Object>} {weights, params}
 */
export async function runOptimizationCycle(currentWeights, currentParams) {
  log('Running AI optimization cycle...', 'INFO');
  
  try {
    // Get recent performance data
    const recentSummaries = await db.getRecentSummaries(7);
    
    if (recentSummaries.length === 0) {
      log('No performance data available for optimization', 'WARN');
      return { weights: currentWeights, params: currentParams };
    }
    
    // Calculate aggregate performance
    let totalTrades = 0;
    let totalWins = 0;
    let totalGrossProfit = 0;
    let totalGrossLoss = 0;
    let maxDD = 0;
    
    for (const summary of recentSummaries) {
      totalTrades += summary.trades;
      totalWins += summary.wins;
      totalGrossProfit += parseFloat(summary.gross_profit);
      totalGrossLoss += parseFloat(summary.gross_loss);
      maxDD = Math.max(maxDD, parseFloat(summary.max_drawdown));
    }
    
    const aggregatePerformance = {
      win_rate: safeDivide(totalWins, totalTrades),
      profit_factor: safeDivide(totalGrossProfit, totalGrossLoss),
      max_drawdown: maxDD,
      avg_win: safeDivide(totalGrossProfit, totalWins),
      avg_loss: safeDivide(totalGrossLoss, totalTrades - totalWins),
      net_pnl: totalGrossProfit - totalGrossLoss,
      trades: totalTrades,
      avg_trade_risk: currentParams.RISK_CAD || 2
    };
    
    log(`Performance (last 7 days): WR=${(aggregatePerformance.win_rate * 100).toFixed(1)}%, ` +
        `PF=${aggregatePerformance.profit_factor.toFixed(2)}, ` +
        `MaxDD=${aggregatePerformance.max_drawdown.toFixed(2)} CAD`, 'INFO');
    
    // Optimize parameters
    const optimizedParams = await optimizeParameters(
      currentParams, 
      aggregatePerformance,
      currentParams.RISK_CAD || 2
    );
    
    // Save to database
    const weightsToSave = {
      w_rsi: currentWeights.w_rsi,
      w_ema: currentWeights.w_ema,
      w_atr: currentWeights.w_atr,
      w_vol: currentWeights.w_vol,
      rsi_oversold: optimizedParams.rsi_oversold || currentParams.RSI_OVERSOLD,
      rsi_overbought: optimizedParams.rsi_overbought || currentParams.RSI_OVERBOUGHT,
      atr_low_pct: optimizedParams.atr_low_pct || currentParams.ATR_LOW_PCT,
      atr_high_pct: optimizedParams.atr_high_pct || currentParams.ATR_HIGH_PCT,
      performance_snapshot: aggregatePerformance
    };
    
    await db.insertWeights(weightsToSave);
    
    // Save to JSON file
    await saveWeightsToFile({
      ...weightsToSave,
      updated_at: new Date().toISOString()
    });
    
    log('AI optimization cycle completed', 'SUCCESS');
    
    return {
      weights: currentWeights,
      params: optimizedParams
    };
    
  } catch (error) {
    log(`Error in optimization cycle: ${error.message}`, 'ERROR');
    return { weights: currentWeights, params: currentParams };
  }
}

/**
 * Load weights from database or file
 * @returns {Promise<Object>} Weights object
 */
export async function loadWeights() {
  try {
    // Try loading from database first
    const dbWeights = await db.getLatestWeights();
    
    if (dbWeights) {
      return {
        w_rsi: parseFloat(dbWeights.w_rsi),
        w_ema: parseFloat(dbWeights.w_ema),
        w_atr: parseFloat(dbWeights.w_atr),
        w_vol: parseFloat(dbWeights.w_vol),
        rsi_oversold: dbWeights.rsi_oversold,
        rsi_overbought: dbWeights.rsi_overbought,
        atr_low_pct: parseFloat(dbWeights.atr_low_pct),
        atr_high_pct: parseFloat(dbWeights.atr_high_pct)
      };
    }
    
    // Try loading from file
    const fileWeights = await loadWeightsFromFile();
    if (fileWeights) {
      return fileWeights;
    }
    
    // Return defaults
    log('No saved weights found, using defaults', 'INFO');
    return getDefaultWeights();
    
  } catch (error) {
    log(`Error loading weights: ${error.message}`, 'WARN');
    return getDefaultWeights();
  }
}

/**
 * Get default AI weights
 * @returns {Object} Default weights
 */
export function getDefaultWeights() {
  return {
    w_rsi: 0.40,
    w_ema: 0.30,
    w_atr: 0.15,
    w_vol: 0.15,
    rsi_oversold: 38,
    rsi_overbought: 62,
    atr_low_pct: 0.4,
    atr_high_pct: 2.0
  };
}

/**
 * Save weights to JSON file
 * @param {Object} weights - Weights to save
 * @returns {Promise<void>}
 */
async function saveWeightsToFile(weights) {
  try {
    await fs.writeFile(AI_WEIGHTS_FILE, JSON.stringify(weights, null, 2));
    log(`Weights saved to ${AI_WEIGHTS_FILE}`, 'INFO');
  } catch (error) {
    log(`Error saving weights to file: ${error.message}`, 'WARN');
  }
}

/**
 * Load weights from JSON file
 * @returns {Promise<Object|null>} Weights or null
 */
async function loadWeightsFromFile() {
  try {
    const data = await fs.readFile(AI_WEIGHTS_FILE, 'utf8');
    const weights = JSON.parse(data);
    log(`Weights loaded from ${AI_WEIGHTS_FILE}`, 'INFO');
    return weights;
  } catch (error) {
    return null;
  }
}

/**
 * Get AI status summary
 * @returns {Promise<Object>} AI status
 */
export async function getAIStatus() {
  try {
    const weights = await loadWeights();
    const history = await db.getWeightsHistory(5);
    
    return {
      current: weights,
      history: history.map(h => ({
        timestamp: h.updated_at,
        w_rsi: parseFloat(h.w_rsi),
        w_ema: parseFloat(h.w_ema),
        w_atr: parseFloat(h.w_atr),
        w_vol: parseFloat(h.w_vol),
        performance: h.performance_snapshot
      }))
    };
  } catch (error) {
    log(`Error getting AI status: ${error.message}`, 'ERROR');
    return { current: getDefaultWeights(), history: [] };
  }
}

/**
 * Backtest strategy on historical data (simplified)
 * @param {Array} ohlcv - Historical OHLCV data
 * @param {Object} params - Strategy parameters
 * @param {Object} weights - AI weights
 * @returns {Object} Backtest results
 */
export function backtestStrategy(ohlcv, params, weights) {
  log('Running backtest...', 'INFO');
  
  // This is a simplified backtest implementation
  // In production, you'd want more sophisticated backtesting
  
  let balance = 100; // Start with 100 CAD
  let trades = [];
  let position = null;
  
  for (let i = params.EMA_REGIME; i < ohlcv.length; i++) {
    const slice = ohlcv.slice(0, i + 1);
    // Here you would call analyzeMarket and simulate trades
    // For brevity, this is left as a placeholder
  }
  
  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  
  return {
    trades: trades.length,
    wins,
    losses,
    win_rate: trades.length > 0 ? wins / trades.length : 0,
    total_pnl: totalPnl,
    final_balance: balance + totalPnl
  };
}

// ==================== RUNTIME CONFIG MANAGEMENT ====================

/**
 * Load runtime config from JSON file
 * @returns {Promise<Object>} Runtime config
 */
export async function loadRuntimeConfig() {
  try {
    const data = await fs.readFile(RUNTIME_CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    log(`Runtime config loaded from ${RUNTIME_CONFIG_FILE}`, 'INFO');
    return config;
  } catch (error) {
    log(`Runtime config not found, using defaults`, 'WARN');
    return {
      rsi_oversold: 38,
      rsi_overbought: 62,
      atr_low_pct: 0.4,
      atr_high_pct: 2.0,
      tp_multiplier: 2.4,
      sl_multiplier: 1.2,
      last_optimized: null,
      optimization_history: []
    };
  }
}

/**
 * Save runtime config to JSON file
 * @param {Object} config - Config to save
 * @returns {Promise<void>}
 */
export async function saveRuntimeConfig(config) {
  try {
    const existing = await loadRuntimeConfig();
    
    const updated = {
      rsi_oversold: config.rsi_oversold !== undefined ? config.rsi_oversold : existing.rsi_oversold,
      rsi_overbought: config.rsi_overbought !== undefined ? config.rsi_overbought : existing.rsi_overbought,
      atr_low_pct: config.atr_low_pct !== undefined ? config.atr_low_pct : existing.atr_low_pct,
      atr_high_pct: config.atr_high_pct !== undefined ? config.atr_high_pct : existing.atr_high_pct,
      tp_multiplier: config.tp_multiplier !== undefined ? config.tp_multiplier : existing.tp_multiplier,
      sl_multiplier: config.sl_multiplier !== undefined ? config.sl_multiplier : existing.sl_multiplier,
      last_optimized: new Date().toISOString(),
      optimization_history: [
        ...(existing.optimization_history || []).slice(-9), // Keep last 9
        {
          timestamp: new Date().toISOString(),
          changes: config
        }
      ]
    };
    
    await fs.writeFile(RUNTIME_CONFIG_FILE, JSON.stringify(updated, null, 2));
    log(`Runtime config saved to ${RUNTIME_CONFIG_FILE}`, 'SUCCESS');
  } catch (error) {
    log(`Error saving runtime config: ${error.message}`, 'ERROR');
  }
}

/**
 * Merge runtime config with environment params
 * @param {Object} envParams - Environment parameters
 * @returns {Promise<Object>} Merged parameters
 */
export async function mergeRuntimeConfig(envParams) {
  const runtimeConfig = await loadRuntimeConfig();
  
  return {
    ...envParams,
    RSI_OVERSOLD: runtimeConfig.rsi_oversold || envParams.RSI_OVERSOLD,
    RSI_OVERBOUGHT: runtimeConfig.rsi_overbought || envParams.RSI_OVERBOUGHT,
    ATR_LOW_PCT: runtimeConfig.atr_low_pct || envParams.ATR_LOW_PCT,
    ATR_HIGH_PCT: runtimeConfig.atr_high_pct || envParams.ATR_HIGH_PCT,
    TP_MULTIPLIER: runtimeConfig.tp_multiplier || 2.4,
    SL_MULTIPLIER: runtimeConfig.sl_multiplier || 1.2
  };
}

/**
 * Save updated AI weights to file (public export)
 * @param {Object} weights - Updated weights object
 * @returns {Promise<boolean>} Success status
 */
export async function saveWeights(weights) {
  try {
    if (!weights) throw new Error('No weights provided');

    // Save to JSON file
    await saveWeightsToFile(weights);
    
    // Also save to database for persistence
    const weightsToSave = {
      w_rsi: weights.w_rsi,
      w_ema: weights.w_ema,
      w_atr: weights.w_atr,
      w_vol: weights.w_vol,
      updated_at: new Date().toISOString()
    };
    
    await db.insertWeights(weightsToSave);
    
    log(`[AI] Weights saved successfully`, 'INFO');
    return true;
  } catch (err) {
    log(`[AI] Error saving weights: ${err.message}`, 'ERROR');
    return false;
  }
}

// ==================== SELF-LEARNING MODE ====================

/**
 * Self-learning trade analysis and weight optimization
 * @param {Object} tradeData - Trade data {pnl, entry_reason, exit_reason, indicators}
 * @param {Object} currentWeights - Current AI weights
 * @returns {Promise<Object>} {newWeights, reasonText, adjustmentText}
 */
export async function analyzeTradeAndOptimize(tradeData) {
  try {
    const { pnl, entry_reason, exit_reason, indicators } = tradeData;
    const currentWeights = await loadWeights();
    
    // Determine if profit or loss
    const isProfit = pnl > 0;
    
    // Create reason text based on exit reason
    const reasonText = generateReasonText(exit_reason, indicators);
    
    // Optimize weights based on result
    const { newWeights, adjustmentText } = optimizeWeightsFromTrade(currentWeights, pnl);
    
    // Save updated weights
    await saveWeights(newWeights);
    
    // Log learning event
    await logLearningEvent({
      timestamp: new Date().toISOString(),
      result: isProfit ? 'PROFIT' : 'LOSS',
      pnl: pnl,
      reason: reasonText,
      adjustments: adjustmentText,
      weights: newWeights
    });
    
    // Update runtime config if needed
    await checkAndUpdateRuntimeConfig();
    
    log(`[AI] Self-learning update applied: ${isProfit ? 'PROFIT' : 'LOSS'}`, 'INFO');
    
    return {
      newWeights,
      reasonText,
      adjustmentText,
      isProfit
    };
    
  } catch (error) {
    log(`[AI] Error in self-learning analysis: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Optimize weights based on trade result
 * @param {Object} weights - Current weights
 * @param {number} pnl - Trade PnL
 * @returns {Object} {newWeights, adjustmentText}
 */
function optimizeWeightsFromTrade(weights, pnl) {
  const isProfit = pnl > 0;
  const newWeights = { ...weights };
  
  let adjustmentText = '';
  
  if (isProfit) {
    // Profit: Increase RSI and EMA weights, decrease ATR and VOL
    newWeights.w_rsi = Math.min(0.6, newWeights.w_rsi + 0.01);
    newWeights.w_ema = Math.min(0.6, newWeights.w_ema + 0.01);
    newWeights.w_atr = Math.max(0.1, newWeights.w_atr - 0.005);
    newWeights.w_vol = Math.max(0.1, newWeights.w_vol - 0.005);
    
    adjustmentText = 'RSI +1%, EMA +1%, ATR -0.5%, VOL -0.5%';
  } else {
    // Loss: Decrease RSI and EMA weights, increase ATR and VOL
    newWeights.w_rsi = Math.max(0.1, newWeights.w_rsi - 0.01);
    newWeights.w_ema = Math.max(0.1, newWeights.w_ema - 0.01);
    newWeights.w_atr = Math.min(0.6, newWeights.w_atr + 0.005);
    newWeights.w_vol = Math.min(0.6, newWeights.w_vol + 0.005);
    
    adjustmentText = 'RSI -1%, EMA -1%, ATR +0.5%, VOL +0.5%';
  }
  
  // Normalize weights to sum to 1.0
  const total = newWeights.w_rsi + newWeights.w_ema + newWeights.w_atr + newWeights.w_vol;
  newWeights.w_rsi /= total;
  newWeights.w_ema /= total;
  newWeights.w_atr /= total;
  newWeights.w_vol /= total;
  
  return { newWeights, adjustmentText };
}

/**
 * Generate reason text based on exit reason and indicators
 * @param {string} exitReason - Exit reason
 * @param {Object} indicators - Market indicators
 * @returns {string} Reason text
 */
function generateReasonText(exitReason, indicators) {
  const reasonMap = {
    'STOP_LOSS': 'EMA kırıldı, RSI toparlanamadı, stop-loss tetiklendi',
    'TAKE_PROFIT': 'Hedef fiyat seviyesine ulaşıldı, kâr alımı yapıldı',
    'RSI_OVERBOUGHT': 'RSI aşırı alım seviyesine çıktı, momentum zayıfladı',
    'BEARISH_REGIME': 'Fiyat EMA200 altına düştü, bearish trend başladı',
    'TRAILING_STOP': 'Trailing stop tetiklendi, trend dönüşü tespit edildi',
    'MANUAL': 'Manuel pozisyon kapatma',
    'TIMEOUT': 'Zaman aşımı, pozisyon otomatik kapatıldı'
  };
  
  return reasonMap[exitReason] || 'Bilinmeyen sebep';
}

/**
 * Log learning event to AI learning log
 * @param {Object} eventData - Learning event data
 */
async function logLearningEvent(eventData) {
  try {
    // Load existing log
    let logData = [];
    try {
      const data = await fs.readFile(AI_LEARNING_LOG_FILE, 'utf8');
      logData = JSON.parse(data);
    } catch {
      logData = [];
    }
    
    // Add new event
    logData.push(eventData);
    
    // Keep only last 50 events
    if (logData.length > 50) {
      logData = logData.slice(-50);
    }
    
    // Save updated log
    await fs.writeFile(AI_LEARNING_LOG_FILE, JSON.stringify(logData, null, 2));
    
  } catch (error) {
    log(`[AI] Error logging learning event: ${error.message}`, 'WARN');
  }
}

/**
 * Check and update runtime config based on performance
 */
async function checkAndUpdateRuntimeConfig() {
  try {
    const recentLogs = await getRecentLearningLogs(10);
    if (recentLogs.length < 5) return; // Need at least 5 trades for analysis
    
    const winRate = recentLogs.filter(log => log.result === 'PROFIT').length / recentLogs.length;
    const avgPnL = recentLogs.reduce((sum, log) => sum + log.pnl, 0) / recentLogs.length;
    
    const currentConfig = await loadRuntimeConfig();
    let updated = false;
    
    // Win rate optimization
    if (winRate < 0.5) {
      currentConfig.rsi_oversold = Math.max(30, currentConfig.rsi_oversold - 1);
      currentConfig.rsi_overbought = Math.min(70, currentConfig.rsi_overbought + 1);
      updated = true;
    }
    
    // Profit factor optimization
    if (avgPnL < 0) {
      currentConfig.tp_multiplier = Math.min(3.5, currentConfig.tp_multiplier * 1.1);
      updated = true;
    }
    
    // Drawdown protection
    const maxLoss = Math.min(...recentLogs.map(log => log.pnl));
    if (maxLoss < -20) { // Assuming 20 CAD risk per trade
      currentConfig.sl_multiplier = Math.max(0.8, currentConfig.sl_multiplier * 0.9);
      updated = true;
    }
    
    if (updated) {
      await saveRuntimeConfig(currentConfig);
      log(`[AI] Runtime config optimized: WR=${(winRate*100).toFixed(1)}%, AvgPnL=${avgPnL.toFixed(2)}`, 'INFO');
    }
    
  } catch (error) {
    log(`[AI] Error updating runtime config: ${error.message}`, 'WARN');
  }
}

/**
 * Get recent learning logs
 * @param {number} count - Number of recent logs to get
 * @returns {Promise<Array>} Recent learning logs
 */
async function getRecentLearningLogs(count = 10) {
  try {
    const data = await fs.readFile(AI_LEARNING_LOG_FILE, 'utf8');
    const logs = JSON.parse(data);
    return logs.slice(-count);
  } catch {
    return [];
  }
}

/**
 * Check for low-risk mode activation
 * @returns {Promise<Object>} {activated: boolean, message: string}
 */
export async function checkLowRiskMode() {
  try {
    const recentLogs = await getRecentLearningLogs(10);
    if (recentLogs.length < 10) return { activated: false, message: '' };
    
    // Count losses in last 10 trades
    const losses = recentLogs.filter(log => log.result === 'LOSS').length;
    
    if (losses >= 5) {
      // Activate low-risk mode
      const currentConfig = await loadRuntimeConfig();
      
      // Reduce risk and increase TP
      currentConfig.tp_multiplier = 2.0;
      currentConfig.sl_multiplier = Math.max(0.8, currentConfig.sl_multiplier * 0.9);
      
      await saveRuntimeConfig(currentConfig);
      
      const message = `⚠️ Low-Risk Mode Activated\n\n` +
                     `Reason: ${losses}/10 consecutive losses\n` +
                     `TP: ${currentConfig.tp_multiplier}x\n` +
                     `SL: ${currentConfig.sl_multiplier}x`;
      
      log(`[AI] Low-risk mode activated: ${losses}/10 losses`, 'WARN');
      
      return { activated: true, message };
    }
    
    return { activated: false, message: '' };
    
  } catch (error) {
    log(`[AI] Error checking low-risk mode: ${error.message}`, 'WARN');
    return { activated: false, message: '' };
  }
}

/**
 * Create backup of AI files
 */
export async function createAIBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const backupDir = path.join(AI_MEMORY_DIR, timestamp);
    
    await fs.mkdir(backupDir, { recursive: true });
    
    // Copy files
    const files = [AI_WEIGHTS_FILE, RUNTIME_CONFIG_FILE, AI_LEARNING_LOG_FILE];
    for (const file of files) {
      try {
        await fs.copyFile(file, path.join(backupDir, file));
      } catch {
        // File might not exist, skip
      }
    }
    
    log(`[AI] Backup created: ${backupDir}`, 'INFO');
    return backupDir;
    
  } catch (error) {
    log(`[AI] Error creating backup: ${error.message}`, 'ERROR');
    return null;
  }
}

