/**
 * Trading strategy implementation
 * EMA + RSI + ATR + Volume analysis
 * Enhanced with closed candle guarantee, time-based exit, trailing stop
 */

import { 
  calculateEMA, 
  calculateRSI, 
  calculateATRPercent,
  calculateZScore,
  calculateATR
} from './indicators.js';
import { log, clamp } from './utils.js';

// Time-based exit: close position if no TP/SL hit within this many candles
const TIME_EXIT_CANDLES = 45;

/**
 * Analyze market data and generate trading signal
 * IMPORTANT: Signal is based on close[-2] (completed candle), 
 * but execution uses close[-1] (current/last price)
 * @param {Array} ohlcv - OHLCV data
 * @param {Object} params - Strategy parameters
 * @param {Object} weights - AI weights
 * @returns {Object|null} Signal object or null
 */
export function analyzeMarket(ohlcv, params, weights) {
  if (!ohlcv || ohlcv.length < params.EMA_REGIME + 1) {
    log('Insufficient data for analysis (need at least EMA_REGIME + 1 candles)', 'WARN');
    return null;
  }

  // Use close[-2] for analysis (confirmed closed candle)
  // Use close[-1] for current price (execution reference)
  const closes = ohlcv.map(candle => candle.close);
  const volumes = ohlcv.map(candle => candle.volume);
  
  // For signal generation: use data up to close[-2]
  const closesForSignal = closes.slice(0, -1); // Remove last incomplete candle
  const volumesForSignal = volumes.slice(0, -1);
  const ohlcvForSignal = ohlcv.slice(0, -1);
  
  // Current price for execution (close[-1])
  const currentPrice = closes[closes.length - 1];
  
  // Closed candle price for signal confirmation
  const closedPrice = closes[closes.length - 2];

  // Calculate indicators using closed candle data
  const ema20 = calculateEMA(closesForSignal, params.EMA_FAST);
  const ema50 = calculateEMA(closesForSignal, params.EMA_SLOW);
  const ema200 = calculateEMA(closesForSignal, params.EMA_REGIME);
  const rsi = calculateRSI(closesForSignal, 14);
  const atrPct = calculateATRPercent(ohlcvForSignal, 14);
  const atr = calculateATR(ohlcvForSignal, 14);
  const volZScore = calculateZScore(volumesForSignal, 20);

  // Debug: Always log indicator values
  log(`    📊 Indicators: RSI=${rsi?.toFixed(1)}, EMA20=${ema20?.toFixed(2)}, EMA50=${ema50?.toFixed(2)}, ` +
      `ATR=${atrPct?.toFixed(2)}%, VolZ=${volZScore?.toFixed(2)}`, 'DEBUG');

  if (ema20 === null || ema50 === null || ema200 === null || 
      rsi === null || atrPct === null || volZScore === null || atr === null) {
    log('Indicator calculation returned null', 'WARN');
    return null;
  }

  // Regime filter: Skip EMA filter for extreme oversold (RSI < 30)
  // Rationale: When RSI is extremely low, it's a strong buy signal regardless of trend
  const isExtremeOversold = rsi < 30;
  const inBullishRegime = isExtremeOversold ? true : (closedPrice > ema200);
  
  if (isExtremeOversold) {
    log(`Extreme oversold detected (RSI=${rsi.toFixed(1)}) - EMA filter bypassed`, 'SUCCESS');
  }
  
  // Trend: EMA20 > EMA50
  const trendIsBullish = ema20 > ema50;
  
  // RSI oversold
  const isOversold = rsi < params.RSI_OVERSOLD;
  
  // RSI overbought
  const isOverbought = rsi > params.RSI_OVERBOUGHT;
  
  // Volatility in acceptable range
  const volatilityOK = atrPct >= params.ATR_LOW_PCT && atrPct <= params.ATR_HIGH_PCT;
  
  // Volume strength
  const volumeStrong = volZScore >= params.VOL_Z_MIN;

  // Calculate individual scores (0-1)
  const rsiScore = calculateRSIScore(rsi, params);
  const emaScore = trendIsBullish ? 1 : 0;
  const atrScore = volatilityOK ? 1 : 0;
  const volScore = volumeStrong ? 1 : 0;

  // Calculate weighted confidence
  const confidence = (
    rsiScore * weights.w_rsi +
    emaScore * weights.w_ema +
    atrScore * weights.w_atr +
    volScore * weights.w_vol
  );

  const signal = {
    timestamp: new Date(),
    price: currentPrice, // Execution price (close[-1])
    closedPrice: closedPrice, // Signal price (close[-2])
    atr: atr, // Raw ATR value for SL/TP calculation
    indicators: {
      ema20,
      ema50,
      ema200,
      rsi,
      atrPct,
      volZScore
    },
    scores: {
      rsi: rsiScore,
      ema: emaScore,
      atr: atrScore,
      vol: volScore
    },
    confidence,
    conditions: {
      inBullishRegime,
      trendIsBullish,
      isOversold,
      isOverbought,
      volatilityOK,
      volumeStrong
    },
    action: null
  };

  // Debug: Always log conditions and confidence
  log(`    🔍 Conditions: regime=${inBullishRegime ? '✅' : '❌'}, trend=${trendIsBullish ? '✅' : '❌'}, ` +
      `oversold=${isOversold ? '✅' : '❌'}, overbought=${isOverbought ? '✅' : '❌'}, ` +
      `vol=${volumeStrong ? '✅' : '❌'}, atr=${volatilityOK ? '✅' : '❌'}, conf=${confidence.toFixed(3)}`, 'DEBUG');

  // Determine action
  // BUY signal: bullish regime + trend + oversold + volatility OK + volume strong + confidence >= threshold
  
  // Debug: Log why we're not buying when RSI is oversold
  if (isOversold) {
    const reasons = [];
    if (!inBullishRegime) reasons.push(`❌ bearish regime (price ${closedPrice.toFixed(2)} < EMA200 ${ema200.toFixed(2)})`);
    if (!trendIsBullish) reasons.push(`❌ bearish trend (EMA20 ${ema20.toFixed(2)} < EMA50 ${ema50.toFixed(2)})`);
    if (!volatilityOK) reasons.push(`❌ volatility (ATR=${atrPct.toFixed(2)}%, range: ${params.ATR_LOW_PCT}-${params.ATR_HIGH_PCT}%)`);
    if (!volumeStrong) reasons.push(`❌ volume weak (Z-score=${volZScore.toFixed(2)}, min: ${params.VOL_Z_MIN})`);
    if (confidence < 0.65) reasons.push(`❌ low confidence (${confidence.toFixed(3)} < 0.65)`);
    
    if (reasons.length > 0) {
      log(`🔍 RSI oversold (${rsi.toFixed(1)}) but NO BUY: ${reasons.join(', ')}`, 'WARN');
    } else {
      log(`✅ All conditions met! RSI=${rsi.toFixed(1)}, confidence=${confidence.toFixed(3)}`, 'SUCCESS');
    }
  }
  
  if (inBullishRegime && isOversold && volatilityOK && volumeStrong) {
    if (confidence >= params.CONFIDENCE_THRESHOLD) {
      signal.action = 'BUY';
      log(`BUY signal generated: confidence=${confidence.toFixed(3)}, RSI=${rsi.toFixed(1)}`, 'SUCCESS');
    }
  }
  
  // SELL signal: overbought or bearish conditions
  // Note: In spot trading, SELL only matters if we have a position
  if (isOverbought || !inBullishRegime) {
    signal.action = 'SELL';
    // Only log if extreme conditions (reduce log spam)
    if (isOverbought && rsi > 70) {
      const reason = isOverbought ? 'overbought' : 'bearish regime';
      log(`SELL signal: ${reason}, RSI=${rsi.toFixed(1)}`, 'INFO');
    }
  }

  // Debug: Final action
  log(`    ➡️  Final action: ${signal.action || 'NONE'}`, 'DEBUG');

  return signal;
}

/**
 * Calculate RSI score (0-1)
 * Higher score for more oversold conditions
 * @param {number} rsi - RSI value
 * @param {Object} params - Strategy parameters
 * @returns {number} Score between 0 and 1
 */
function calculateRSIScore(rsi, params) {
  if (rsi <= params.RSI_OVERSOLD) {
    // More oversold = higher score
    return 1 - (rsi / params.RSI_OVERSOLD);
  } else if (rsi >= params.RSI_OVERBOUGHT) {
    // Overbought = low score
    return 0;
  } else {
    // Neutral zone
    const midpoint = (params.RSI_OVERSOLD + params.RSI_OVERBOUGHT) / 2;
    const distance = Math.abs(rsi - midpoint);
    const range = params.RSI_OVERBOUGHT - params.RSI_OVERSOLD;
    return 1 - (distance / (range / 2));
  }
}

/**
 * Calculate stop loss and take profit prices
 * @param {number} entryPrice - Entry price
 * @param {number} atrValue - ATR value
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} atrMultiplierSL - ATR multiplier for stop loss (default 1.2)
 * @param {number} atrMultiplierTP - ATR multiplier for take profit (default 2.4)
 * @returns {Object} {stopLoss, takeProfit}
 */
export function calculateStopLossTakeProfit(
  entryPrice, 
  atrValue, 
  side = 'BUY',
  atrMultiplierSL = 1.2,
  atrMultiplierTP = 2.4
) {
  let stopLoss, takeProfit;

  if (side === 'BUY') {
    stopLoss = entryPrice - (atrValue * atrMultiplierSL);
    takeProfit = entryPrice + (atrValue * atrMultiplierTP);
  } else {
    // For SELL (short) - but we don't use this in spot
    stopLoss = entryPrice + (atrValue * atrMultiplierSL);
    takeProfit = entryPrice - (atrValue * atrMultiplierTP);
  }

  return {
    stopLoss: Math.max(stopLoss, 0),
    takeProfit: Math.max(takeProfit, 0)
  };
}

/**
 * Check if stop loss, take profit, or time exit is hit
 * @param {Object} position - Current position data
 * @param {number} currentPrice - Current market price
 * @param {number} candlesElapsed - Candles since entry (optional)
 * @returns {Object} {hit: boolean, reason: string|null, exitPrice: number|null}
 */
export function checkExitConditions(position, currentPrice, candlesElapsed = null) {
  if (!position) return { hit: false, reason: null, exitPrice: null };

  // Check stop loss
  if (position.stop_loss && currentPrice <= position.stop_loss) {
    return {
      hit: true,
      reason: 'STOP_LOSS',
      exitPrice: currentPrice // Use current price for market exit
    };
  }

  // Check take profit
  if (position.take_profit && currentPrice >= position.take_profit) {
    return {
      hit: true,
      reason: 'TAKE_PROFIT',
      exitPrice: currentPrice
    };
  }

  // Check time-based exit (45 candles with no TP/SL)
  if (candlesElapsed !== null && candlesElapsed >= TIME_EXIT_CANDLES) {
    return {
      hit: true,
      reason: 'TIME_EXIT',
      exitPrice: currentPrice
    };
  }

  return { hit: false, reason: null, exitPrice: null };
}

/**
 * Calculate trailing stop loss
 * @param {Object} position - Position data
 * @param {number} currentPrice - Current price
 * @param {number} riskReward - Risk/reward ratio reached (e.g., 1.0 = 1R profit)
 * @returns {number|null} New stop loss or null if no adjustment
 */
export function calculateTrailingStop(position, currentPrice, riskReward = 1.0) {
  if (!position || !position.entry_price || !position.stop_loss) return null;
  
  const entryPrice = position.entry_price;
  const originalRisk = entryPrice - position.stop_loss;
  
  // Only trail if we've reached at least 1R profit
  if (riskReward >= 1.0) {
    // Move stop to break-even + small buffer (0.1R)
    const newStopLoss = entryPrice + (originalRisk * 0.1);
    
    // Only update if new SL is higher than current
    if (newStopLoss > position.stop_loss) {
      log(`Trailing stop: ${position.stop_loss.toFixed(2)} -> ${newStopLoss.toFixed(2)}`, 'INFO');
      return newStopLoss;
    }
  }
  
  return null;
}

/**
 * Calculate current risk/reward ratio
 * @param {Object} position - Position data
 * @param {number} currentPrice - Current price
 * @returns {number} Risk/reward ratio
 */
export function calculateRiskReward(position, currentPrice) {
  if (!position || !position.entry_price || !position.stop_loss) return 0;
  
  const entryPrice = position.entry_price;
  const risk = entryPrice - position.stop_loss;
  const currentProfit = currentPrice - entryPrice;
  
  if (risk === 0) return 0;
  return currentProfit / risk;
}

/**
 * Calculate candles elapsed since position opened
 * @param {Date} openedAt - Position opened timestamp
 * @param {number} timeframeMinutes - Timeframe in minutes (default 1)
 * @returns {number} Number of candles elapsed
 */
export function calculateCandlesElapsed(openedAt, timeframeMinutes = 1) {
  const now = new Date();
  const elapsed = now - new Date(openedAt);
  const minutes = elapsed / 1000 / 60;
  return Math.floor(minutes / timeframeMinutes);
}

/**
 * Validate trading conditions before opening position
 * @param {Object} signal - Trading signal
 * @param {Object} riskLimits - Risk management limits
 * @param {Object} currentState - Current trading state
 * @returns {Object} {allowed: boolean, reason: string}
 */
export function validateTradeConditions(signal, riskLimits, currentState) {
  // Check if signal is strong enough
  if (!signal || !signal.action) {
    return { allowed: false, reason: 'No valid signal' };
  }

  // Check confidence threshold
  if (signal.confidence < 0.65) {
    return { allowed: false, reason: `Low confidence: ${signal.confidence.toFixed(3)}` };
  }

  // Check daily loss limit
  if (currentState.todayPnL <= -riskLimits.maxDailyLoss) {
    return { 
      allowed: false, 
      reason: `Daily loss limit reached: ${currentState.todayPnL.toFixed(2)} CAD` 
    };
  }

  // Check daily trade limit
  if (currentState.todayTradesCount >= riskLimits.maxDailyTrades) {
    return { 
      allowed: false, 
      reason: `Daily trade limit reached: ${currentState.todayTradesCount}` 
    };
  }

  // Check cooldown period
  if (currentState.lastTradeTime && riskLimits.cooldownMinutes > 0) {
    const lastTradeLoss = currentState.lastTradePnL < 0;
    if (lastTradeLoss) {
      const timeSinceLastTrade = (Date.now() - currentState.lastTradeTime.getTime()) / 1000 / 60;
      if (timeSinceLastTrade < riskLimits.cooldownMinutes) {
        return { 
          allowed: false, 
          reason: `Cooldown period: ${(riskLimits.cooldownMinutes - timeSinceLastTrade).toFixed(1)} min remaining` 
        };
      }
    }
  }

  // Check if already in position
  if (currentState.hasOpenPosition && signal.action === 'BUY') {
    return { allowed: false, reason: 'Already in position' };
  }

  // Check if no position to sell
  if (!currentState.hasOpenPosition && signal.action === 'SELL') {
    return { allowed: false, reason: 'No position to sell' };
  }

  return { allowed: true, reason: 'OK' };
}

/**
 * Create position object
 * @param {Object} signal - Trading signal
 * @param {number} qty - Position size
 * @param {number} stopLoss - Stop loss price
 * @param {number} takeProfit - Take profit price
 * @param {string} symbol - Trading symbol
 * @returns {Object} Position object
 */
export function createPosition(signal, qty, stopLoss, takeProfit, symbol) {
  return {
    symbol,
    side: signal.action,
    qty,
    entry_price: signal.price,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    ai_confidence: signal.confidence,
    atr_pct: signal.indicators.atrPct,
    opened_at: signal.timestamp
  };
}

/**
 * Calculate trade PnL
 * @param {Object} position - Position object
 * @param {number} exitPrice - Exit price
 * @returns {Object} {pnl, pnl_pct}
 */
export function calculatePnL(position, exitPrice) {
  let pnl, pnl_pct;

  if (position.side === 'BUY') {
    pnl = (exitPrice - position.entry_price) * position.qty;
    pnl_pct = ((exitPrice - position.entry_price) / position.entry_price) * 100;
  } else {
    // For SELL/SHORT (not used in spot, but kept for completeness)
    pnl = (position.entry_price - exitPrice) * position.qty;
    pnl_pct = ((position.entry_price - exitPrice) / position.entry_price) * 100;
  }

  return {
    pnl: parseFloat(pnl.toFixed(8)),
    pnl_pct: parseFloat(pnl_pct.toFixed(4))
  };
}

/**
 * Format signal for logging/display
 * @param {Object} signal - Signal object
 * @returns {string} Formatted signal string
 */
export function formatSignal(signal) {
  if (!signal) return 'No signal';
  
  const ind = signal.indicators;
  return `
    Action: ${signal.action || 'NONE'}
    Confidence: ${signal.confidence.toFixed(3)}
    Price: ${signal.price.toFixed(2)}
    RSI: ${ind.rsi.toFixed(1)}
    EMA20: ${ind.ema20.toFixed(2)} | EMA50: ${ind.ema50.toFixed(2)} | EMA200: ${ind.ema200.toFixed(2)}
    ATR%: ${ind.atrPct.toFixed(2)}%
    VolZ: ${ind.volZScore.toFixed(2)}
  `.trim();
}

