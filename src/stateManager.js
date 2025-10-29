/**
 * StateManager - Centralized state management for Kraken AI Trading Bot
 * Replaces all direct global.* variables with a clean state management system
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'runtime-config.json');

class StateManager {
  constructor() {
    this.state = {
      isRunning: false,
      currentWeights: null,
      currentParams: null,
      runtimeConfig: null,
      lastOptimizationTime: null,
      lastMarketSummaryTime: null,
      lastLoopTime: null,
      lastRecordedBalance: null,
      recentSignals: [],
      openPositions: new Map(),
      tradingEnabled: true,
      lastTradeTime: null,
      lastTradePnL: 0,
      dailyStats: {
        date: new Date().toISOString().split('T')[0],
        tradesCount: 0,
        realizedPnL: 0
      },
      dryRun: false,
      feeRates: { taker: 0.0026, maker: 0.0016 },
      emergencyFlat: false, // Emergency flat flag
      warningFlags: {
        atrWarningShown: false,
        atrPctWarningShown: false
      },
      symbolStates: new Map(), // Multi-symbol support
      startTime: Date.now()
    };
    
    this.loadConfig();
  }

  /**
   * Load runtime configuration
   */
  async loadConfig() {
    try {
      const configData = await fs.readFile(CONFIG_FILE, 'utf8');
      this.state.runtimeConfig = JSON.parse(configData);
      this.state.currentParams = this.state.runtimeConfig.strategy;
      
      // Initialize symbol states
      if (this.state.runtimeConfig.symbols) {
        for (const symbol of this.state.runtimeConfig.symbols) {
          this.state.symbolStates.set(symbol, {
            lastSignalTime: null,
            lastTradeTime: null,
            dailyTrades: 0,
            dailyPnL: 0,
            aiWeights: null,
            lastOptimization: null
          });
        }
      }
    } catch (error) {
      console.error('Failed to load runtime config:', error.message);
      // Use default config
      this.state.runtimeConfig = {
        symbols: ['BTC/CAD'],
        side_bias: 'LONG_ONLY',
        strategy: {
          RSI_OVERSOLD: 34,
          RSI_OVERBOUGHT: 66,
          RISK_CAD: 20,
          MAX_DAILY_LOSS_CAD: -40,
          MAX_DAILY_TRADES: 10
        }
      };
      this.state.currentParams = this.state.runtimeConfig.strategy;
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Set state property
   */
  setState(key, value) {
    this.state[key] = value;
  }

  /**
   * Update parameter
   */
  updateParam(key, value) {
    if (this.state.currentParams) {
      this.state.currentParams[key] = value;
    }
  }

  /**
   * Reset flags
   */
  resetFlags() {
    this.state.isRunning = false;
    this.state.tradingEnabled = true;
    this.state.dryRun = false;
  }

  /**
   * Get symbol-specific state
   */
  getSymbolState(symbol) {
    return this.state.symbolStates.get(symbol) || {};
  }

  /**
   * Set symbol-specific state
   */
  setSymbolState(symbol, key, value) {
    if (!this.state.symbolStates.has(symbol)) {
      this.state.symbolStates.set(symbol, {});
    }
    this.state.symbolStates.get(symbol)[key] = value;
  }

  /**
   * Get uptime in minutes
   */
  getUptime() {
    return Math.floor((Date.now() - this.state.startTime) / 60000);
  }

  /**
   * Get side bias setting
   */
  getSideBias() {
    return this.state.runtimeConfig?.side_bias || 'LONG_ONLY';
  }

  /**
   * Check if trading is allowed for symbol
   */
  isTradingAllowed(symbol) {
    // Global trading kontrolü
    if (!this.state.tradingEnabled) {
      console.log(`🚫 Trading disabled globally for ${symbol}`);
      return false;
    }
    
    // Dry-run kontrolü artık exchange.js'de yapılıyor
    
    // Symbol-specific state kontrolü
    const symbolState = this.getSymbolState(symbol);
    const dailyTrades = symbolState.dailyTrades || 0;
    const dailyPnL = symbolState.dailyPnL || 0;
    
    // Symbol-specific daily loss limit (if configured)
    const symbolLimits = this.state.runtimeConfig?.symbol_limits || {};
    const symbolSpecificLoss = symbolLimits[symbol];
    
    // Debug logging
    console.log(`🔍 Trading check for ${symbol}:`, {
      tradingEnabled: this.state.tradingEnabled,
      dryRun: this.state.dryRun,
      dailyTrades,
      maxDailyTrades: this.state.currentParams?.MAX_DAILY_TRADES || 10,
      dailyPnL,
      maxDailyLoss: symbolSpecificLoss || this.state.currentParams?.MAX_DAILY_LOSS_CAD || -40,
      symbolSpecificLoss: symbolSpecificLoss || 'using global',
      symbolState: symbolState,
      lossCheck: `${dailyPnL} <= -${Math.abs(symbolSpecificLoss || this.state.currentParams?.MAX_DAILY_LOSS_CAD || -40)} = ${dailyPnL <= -Math.abs(symbolSpecificLoss || this.state.currentParams?.MAX_DAILY_LOSS_CAD || -40)}`
    });
    
    // Daily limits kontrolü
    const maxDailyTrades = this.state.currentParams?.MAX_DAILY_TRADES || 10;
    
    const rawMaxDailyLoss = symbolSpecificLoss || this.state.currentParams?.MAX_DAILY_LOSS_CAD || -40;
    const maxDailyLoss = Math.abs(rawMaxDailyLoss); // Normalize to positive
    
    // Debug log for the condition evaluation
    const lossThreshold = -maxDailyLoss;
    const lossLimitBreached = dailyPnL <= lossThreshold;
    
    console.log(`[DEBUG] Daily loss check: ${dailyPnL} <= ${lossThreshold} ? ${lossLimitBreached}`);
    
    if (dailyTrades >= maxDailyTrades) {
      console.log(`🚫 Daily trade limit reached for ${symbol}: ${dailyTrades}/${maxDailyTrades}`);
      return false;
    }
    
    if (lossLimitBreached) {
      console.log(`🚫 Daily loss limit reached for ${symbol}: ${dailyPnL}/${lossThreshold}`);
      return false;
    } else {
      console.log(`✅ Daily loss within safe range: ${dailyPnL}/${maxDailyLoss}`);
    }
    
    console.log(`✅ Trading allowed for ${symbol}`);
    return true;
  }

  /**
   * Update daily stats for symbol
   */
  updateSymbolDailyStats(symbol, pnl) {
    const symbolState = this.getSymbolState(symbol);
    symbolState.dailyTrades = (symbolState.dailyTrades || 0) + 1;
    symbolState.dailyPnL = (symbolState.dailyPnL || 0) + pnl;
    symbolState.lastTradeTime = Date.now();
    this.setSymbolState(symbol, 'dailyTrades', symbolState.dailyTrades);
    this.setSymbolState(symbol, 'dailyPnL', symbolState.dailyPnL);
    this.setSymbolState(symbol, 'lastTradeTime', symbolState.lastTradeTime);
  }

  /**
   * Reset daily stats for all symbols
   */
  resetDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    this.state.dailyStats = {
      date: today,
      tradesCount: 0,
      realizedPnL: 0
    };
    
    // Reset symbol daily stats
    for (const [symbol, state] of this.state.symbolStates) {
      state.dailyTrades = 0;
      state.dailyPnL = 0;
    }
  }
}

// Create singleton instance
const stateManager = new StateManager();

// Export functions for backward compatibility
export function getState() {
  return stateManager.getState();
}

export function setState(key, value) {
  stateManager.setState(key, value);
}

export function updateParam(key, value) {
  stateManager.updateParam(key, value);
}

export function resetFlags() {
  stateManager.resetFlags();
}

export function getSymbolState(symbol) {
  return stateManager.getSymbolState(symbol);
}

export function setSymbolState(symbol, key, value) {
  stateManager.setSymbolState(symbol, key, value);
}

export function getUptime() {
  return stateManager.getUptime();
}

export function getSideBias() {
  return stateManager.getSideBias();
}

export function isTradingAllowed(symbol) {
  return stateManager.isTradingAllowed(symbol);
}

export function updateSymbolDailyStats(symbol, pnl) {
  stateManager.updateSymbolDailyStats(symbol, pnl);
}

export function resetDailyStats() {
  stateManager.resetDailyStats();
}

export default stateManager;
