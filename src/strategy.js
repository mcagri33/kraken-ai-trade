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
import { sanitizeOHLCV } from './utils/sanitizeOHLCV.js';

// Time-based exit: close position if no TP/SL hit within this many candles
const TIME_EXIT_CANDLES = 45;

/**
 * Calculate sigmoid score for smoother transitions
 * @param {number} value - Input value
 * @param {number} midpoint - Sigmoid midpoint (default: 0)
 * @param {number} steepness - Sigmoid steepness (default: 1)
 * @returns {number} Sigmoid score between 0 and 1
 */
function calculateSigmoidScore(value, midpoint = 0, steepness = 1) {
  return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
}

/**
 * Calculate RSI score using sigmoid instead of linear mapping
 * @param {number} rsi - RSI value
 * @param {number} oversold - Oversold threshold
 * @param {number} overbought - Overbought threshold
 * @returns {number} RSI score between 0 and 1
 */
function calculateRSIScore(rsi, oversold, overbought) {
  // Sigmoid mapping for smoother transitions
  if (rsi < oversold) {
    // Oversold: sigmoid from 0 to 1 as RSI approaches oversold
    return calculateSigmoidScore(rsi, oversold, 0.2);
  } else if (rsi > overbought) {
    // Overbought: sigmoid from 1 to 0 as RSI approaches overbought
    return 1 - calculateSigmoidScore(rsi, overbought, 0.2);
  } else {
    // Neutral zone: linear mapping
    return 0.5;
  }
}

/**
 * Check momentum confirmation for RSI signals
 * @param {number} rsi - Current RSI
 * @param {Array} closes - Price closes array
 * @param {number} ema20 - EMA20 value
 * @param {number} oversold - Oversold threshold
 * @returns {boolean} True if momentum confirms signal
 */
function checkMomentumConfirmation(rsi, closes, ema20, oversold) {
  if (rsi >= oversold) return true; // No confirmation needed for non-oversold
  
  // Check if EMA20 is rising (momentum confirmation)
  if (closes.length < 3) return true; // Not enough data
  
  const currentEMA = ema20;
  const prevEMA = calculateEMA(closes.slice(0, -1), 20);
  
  if (!prevEMA) return true; // Fallback
  
  // EMA20 must be rising for momentum confirmation
  return currentEMA > prevEMA;
}

/**
 * Calculate indicators from OHLCV data
 * @param {Array} ohlcv - OHLCV data
 * @returns {Object} Indicators object
 */
export function calculateIndicators(ohlcv) {
  // Input validation
  if (!ohlcv || !Array.isArray(ohlcv) || ohlcv.length < 5) {
    log('Invalid OHLCV data: insufficient data or not an array', 'ERROR');
    return null;
  }

  // Kraken-specific sanitization
  ohlcv = sanitizeOHLCV(ohlcv);

  if (!ohlcv || ohlcv.length < 5 || ohlcv.filter(c => c.close > 0).length < 5) {
    log(`[WARN] OHLCV too short after cleaning (${ohlcv?.length || 0}) — forcing continuity mode`, 'WARN');
    // Continuity mode: 30 sentetik mum oluştur
    const base = 100000;
    ohlcv = Array.from({ length: 30 }, (_, i) => ({
      time: Date.now() - (30 - i) * 60_000,
      open: base,
      high: base,
      low: base,
      close: base,
      volume: 0
    }));
    log(`[WARN] DRY-RUN continuity mode active — generating synthetic candles.`, 'WARN');
  }

  // Extract arrays
  const closes = ohlcv.map(c => c.close || c[4] || 0);
  const volumes = ohlcv.map(c => c.volume || c[5] || 0);
  const close = closes[closes.length - 1] || 1;

  // Calculate indicators with guards
  let rsi = calculateRSI(closes, 14);
  let ema20 = calculateEMA(closes, 20);
  let ema50 = calculateEMA(closes, 50);
  let ema200 = calculateEMA(closes, 200);
  let atr = calculateATR(ohlcv, 14);
  let atrPct = calculateATRPercent(ohlcv, 14);
  let volZScore = calculateZScore(volumes, 20);

  // === Safe fallback guards ===
  if (!rsi || isNaN(rsi)) {
    console.warn(`[WARN] RSI invalid (${rsi}) — using fallback 50`);
    rsi = 50;
  }
  if (!ema20 || isNaN(ema20)) ema20 = close;
  if (!ema50 || isNaN(ema50)) ema50 = close;
  if (!ema200 || isNaN(ema200)) ema200 = close;
  // ATR uyarı spam'ını önlemek için flag sistemi
  if (!global.atrWarningShown) global.atrWarningShown = false;

  if (!atr || isNaN(atr) || atr <= 0) {
    if (!global.atrWarningShown) {
      console.warn(`[WARN] ATR invalid (${atr}) — using fallback 0.01`);
      global.atrWarningShown = true;
    }
    atr = 0.01;
  }

  // ATR% güvenli hesaplama
  if (!global.atrPctWarningShown) global.atrPctWarningShown = false;

  if (!atrPct || isNaN(atrPct) || atrPct <= 0) {
    if (isFinite(atr) && atr > 0 && isFinite(close) && close > 0) {
      atrPct = (atr / close) * 100;
    }
    if (!atrPct || isNaN(atrPct) || atrPct <= 0) {
      if (!global.atrPctWarningShown) {
        console.warn(`[WARN] ATR_PCT invalid (${atrPct}) — using safe fallback 0.01`);
        global.atrPctWarningShown = true;
      }
      atrPct = 0.01;
    }
  }

  if (!volZScore || isNaN(volZScore)) volZScore = 0;

  // Ortalama ATR%
  const atrSeries = [];
  for (let i = Math.max(0, ohlcv.length - 10); i < ohlcv.length; i++) {
    const val = calculateATRPercent(ohlcv.slice(0, i + 1), 14);
    if (val && isFinite(val)) atrSeries.push(val);
  }
  const avgATRPct = atrSeries.length > 0
    ? atrSeries.reduce((a, b) => a + b, 0) / atrSeries.length
    : atrPct;

  // Return final indicators safely
  return {
    rsi: Array.isArray(rsi) ? rsi[rsi.length - 1] : rsi,
    ema20: Array.isArray(ema20) ? ema20[ema20.length - 1] : ema20,
    ema50: Array.isArray(ema50) ? ema50[ema50.length - 1] : ema50,
    ema200: Array.isArray(ema200) ? ema200[ema200.length - 1] : ema200,
    ATR: atr,
    ATR_PCT: avgATRPct,
    atrPct,
    volZScore: Array.isArray(volZScore) ? volZScore[volZScore.length - 1] : volZScore
  };
}

/**
 * Analyze market data and generate trading signal
 * IMPORTANT: Signal is based on close[-2] (completed candle),
 * but execution uses close[-1] (current/last price)
 * @param {Array} ohlcv - OHLCV data
 * @param {Object} params - Strategy parameters
 * @param {Object} weights - AI weights
 * @param {Object} botState - Bot state (for adaptive parameters)
 * @returns {Object|null} Signal object or null
 */
export function analyzeMarket(ohlcv, params, weights, botState = null) {
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

  // Calculate indicators using closed candle data with validation
  const ema20 = calculateEMA(closesForSignal, params.EMA_FAST);
  const ema50 = calculateEMA(closesForSignal, params.EMA_SLOW);
  const ema200 = calculateEMA(closesForSignal, params.EMA_REGIME);
  const rsi = calculateRSI(closesForSignal, 14);
  const atrPct = calculateATRPercent(ohlcvForSignal, 14) || 0.01; // Fallback for ATR_PCT
  const atr = calculateATR(ohlcvForSignal, 14);
  const volZScore = calculateZScore(volumesForSignal, 20) || 0; // Fallback for volume Z-Score

  // Validate all indicators before proceeding
  if (ema20 === null || ema50 === null || ema200 === null || 
      rsi === null || atrPct === null || volZScore === null || atr === null) {
    log('Indicator calculation returned null - insufficient data or calculation error', 'ERROR');
    return null;
  }

  // Debug: Always log indicator values
  log(`    📊 Indicators: RSI=${rsi.toFixed(1)}, EMA20=${ema20.toFixed(2)}, EMA50=${ema50.toFixed(2)}, ` +
      `ATR=${atrPct.toFixed(2)}%, VolZ=${volZScore.toFixed(2)}`, 'DEBUG');

  // Regime filter: Skip EMA filter for extreme oversold (RSI < 30)
  // Rationale: When RSI is extremely low, it's a strong buy signal regardless of trend
  const isExtremeOversold = rsi < 30;
  const inBullishRegime = isExtremeOversold ? true : (closedPrice > ema200);
  
  if (isExtremeOversold) {
    log(`Extreme oversold detected (RSI=${rsi.toFixed(1)}) - EMA filter bypassed`, 'SUCCESS');
  }
  
  // Trend: EMA20 > EMA50
  const trendIsBullish = ema20 > ema50;
  
  // RSI oversold with momentum confirmation
  const isOversold = rsi < params.RSI_OVERSOLD;
  const momentumConfirms = params.MOMENTUM_CONFIRMATION ? 
    checkMomentumConfirmation(rsi, closesForSignal, ema20, params.RSI_OVERSOLD) : true;
  
  // RSI overbought
  const isOverbought = rsi > params.RSI_OVERBOUGHT;
  
  // Side bias check
  const sideBias = params.SIDE_BIAS || 'LONG_ONLY';
  
  // Volatility in acceptable range
  const volatilityOK = atrPct >= params.ATR_LOW_PCT && atrPct <= params.ATR_HIGH_PCT;
  
  // Volume strength
  const volumeStrong = volZScore >= params.VOL_Z_MIN;

  // Calculate individual scores (0-1)
  const rsiScore = calculateRSIScore(rsi, params.RSI_OVERSOLD, params.RSI_OVERBOUGHT);
  const emaScore = trendIsBullish ? 1 : 0;
  const atrScore = volatilityOK ? 1 : 0;
  const volScore = volumeStrong ? 1 : 0;

  // Calculate weighted confidence with normalization
  const rawConfidence = (
    rsiScore * weights.w_rsi +
    emaScore * weights.w_ema +
    atrScore * weights.w_atr +
    volScore * weights.w_vol
  );
  
  // Normalize confidence to [0,1] range
  const totalWeight = weights.w_rsi + weights.w_ema + weights.w_atr + weights.w_vol;
  const confidence = params.CONFIDENCE_NORMALIZATION ? rawConfidence / totalWeight : rawConfidence;

  // Use adaptive confidence threshold if available
  const atrLowThreshold = botState?.strategy?.atrLowPct || params.ATR_LOW_PCT || 0.01;

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
      volumeStrong,
      momentumConfirms
    },
    volatilityLabel: atrPct < 1.0 ? 'LOW' : atrPct < 2.0 ? 'MED' : 'HIGH',
    action: null
  };

  // Debug: Always log conditions and confidence
  log(`    🔍 Conditions: regime=${inBullishRegime ? '✅' : '❌'}, trend=${trendIsBullish ? '✅' : '❌'}, ` +
      `oversold=${isOversold ? '✅' : '❌'}, overbought=${isOverbought ? '✅' : '❌'}, ` +
      `vol=${volumeStrong ? '✅' : '❌'}, atr=${volatilityOK ? '✅' : '❌'}, conf=${confidence.toFixed(3)}`, 'DEBUG');

  // Determine action with side bias and momentum confirmation
  const confidenceThreshold = botState?.strategy?.confidenceThreshold || params.CONFIDENCE_THRESHOLD || 0.65;
  
  // BUY signal conditions
  const buyConditions = {
    sideBiasOK: sideBias === 'LONG_ONLY' || sideBias === 'BOTH',
    regimeOK: inBullishRegime,
    trendOK: trendIsBullish,
    oversoldOK: isOversold,
    momentumOK: momentumConfirms,
    volatilityOK: volatilityOK,
    volumeOK: volumeStrong,
    confidenceOK: confidence >= confidenceThreshold
  };
  
  // Debug: Log why we're not buying when RSI is oversold
  if (isOversold) {
    const reasons = [];
    if (!buyConditions.sideBiasOK) reasons.push(`❌ side bias (${sideBias})`);
    if (!buyConditions.regimeOK) reasons.push(`❌ bearish regime (price ${closedPrice.toFixed(2)} < EMA200 ${ema200.toFixed(2)})`);
    if (!buyConditions.trendOK) reasons.push(`❌ bearish trend (EMA20 ${ema20.toFixed(2)} < EMA50 ${ema50.toFixed(2)})`);
    if (!buyConditions.momentumOK) reasons.push(`❌ momentum not confirmed (EMA20 not rising)`);
    if (!buyConditions.volatilityOK) reasons.push(`❌ volatility (ATR=${atrPct.toFixed(2)}%, range: ${params.ATR_LOW_PCT}-${params.ATR_HIGH_PCT})`);
    if (!buyConditions.volumeOK) reasons.push(`❌ volume weak (Z-score=${volZScore.toFixed(2)}, min: ${params.VOLUME_THRESHOLD})`);
    if (!buyConditions.confidenceOK) reasons.push(`❌ low confidence (${confidence.toFixed(3)} < ${confidenceThreshold.toFixed(3)})`);
    
    if (reasons.length > 0) {
      log(`🔍 RSI oversold (${rsi.toFixed(1)}) but NO BUY: ${reasons.join(', ')}`, 'WARN');
    } else {
      log(`✅ All conditions met! RSI=${rsi.toFixed(1)}, confidence=${confidence.toFixed(3)}`, 'SUCCESS');
    }
  }
  
  // Generate BUY signal
  if (Object.values(buyConditions).every(condition => condition)) {
    signal.action = 'BUY';
    log(`BUY signal generated: confidence=${confidence.toFixed(3)}, RSI=${rsi.toFixed(1)}, momentum=${momentumConfirms ? '✅' : '❌'}`, 'SUCCESS');
  }
  
  // SELL signal: overbought or bearish conditions (only for BOTH side bias)
  if (sideBias === 'BOTH' && (isOverbought || !inBullishRegime)) {
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
export function calculateTrailingStop(position, currentPrice, riskReward = 1.0, params = null) {
  if (!position || !position.entry_price || !position.stop_loss) return null;
  
  const entryPrice = position.entry_price;
  const originalRisk = entryPrice - position.stop_loss;
  
  // Adaptive trailing stop based on volatility
  let tighteningFactor = 0.1; // Default 0.1R buffer
  
  if (params?.ADAPTIVE_TRAILING_STOP && position.atr_pct !== undefined) {
    const atrPct = position.atr_pct;
    const threshold = params.ATR_TIGHTENING_THRESHOLD || 1.0;
    const tightening = params.SL_TIGHTENING_FACTOR || 0.25;
    
    // If volatility is low, tighten the stop loss
    if (atrPct < threshold) {
      tighteningFactor = tightening; // 25% tighter stop
      log(`Adaptive trailing: Low volatility (ATR=${atrPct.toFixed(2)}%), tightening SL by ${(tighteningFactor * 100).toFixed(0)}%`, 'INFO');
    }
  }
  
  // Only trail if we've reached at least 1R profit
  if (riskReward >= 1.0) {
    // Move stop to break-even + adaptive buffer
    const newStopLoss = entryPrice + (originalRisk * tighteningFactor);
    
    // Only update if new SL is higher than current
    if (newStopLoss > position.stop_loss) {
      log(`Trailing stop: ${position.stop_loss.toFixed(2)} -> ${newStopLoss.toFixed(2)} (${tighteningFactor.toFixed(2)}R buffer)`, 'INFO');
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
export function validateTradeConditions(signal, riskLimits, currentState, params = null) {
  // Check if signal is strong enough
  if (!signal || !signal.action) {
    return { allowed: false, reason: 'No valid signal' };
  }

  // Check confidence threshold
  const confidenceThreshold = params?.CONFIDENCE_THRESHOLD || 0.65;
  if (signal.confidence < confidenceThreshold) {
    return { allowed: false, reason: `Low confidence: ${signal.confidence.toFixed(3)} < ${confidenceThreshold}` };
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
 * Calculate trade PnL with fee-aware logic
 * @param {Object} position - Position object
 * @param {number} exitPrice - Exit price
 * @returns {Object} {pnl, pnl_pct, grossPnL, netPnL, totalFees}
 */
export function calculatePnL(position, exitPrice) {
  const grossExitValue = position.qty * exitPrice;
  const entryCost = position.qty * position.entry_price;
  const entryFee = position.entry_fee || 0;
  const exitFee = position.exit_fee || 0;
  
  // Fee-aware net calculations
  const grossPnL = grossExitValue - entryCost;
  const totalFees = entryFee + exitFee;
  let netPnL = grossPnL - totalFees;
  let netPnLPct = entryCost > 0 ? (netPnL / entryCost) * 100 : 0;
  
  // PnL rounding: küçük oynaklıkları sıfırla (spam log önleme)
  if (Math.abs(netPnL) < 0.001) netPnL = 0;
  if (Math.abs(netPnLPct) < 0.01) netPnLPct = 0;

  return {
    pnl: parseFloat(netPnL.toFixed(2)), // Net PnL for backward compatibility
    pnl_pct: parseFloat(netPnLPct.toFixed(2)),
    grossPnL: parseFloat(grossPnL.toFixed(2)),
    netPnL: parseFloat(netPnL.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(4)),
    grossExitValue: parseFloat(grossExitValue.toFixed(2)),
    entryCost: parseFloat(entryCost.toFixed(2))
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

