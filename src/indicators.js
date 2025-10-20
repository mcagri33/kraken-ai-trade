/**
 * Technical indicators for trading strategy
 */

import { average, standardDeviation } from './utils.js';

/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} data - Price data
 * @param {number} period - Period length
 * @returns {number|null} SMA value or null if not enough data
 */
export function calculateSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return average(slice);
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} data - Price data
 * @param {number} period - Period length
 * @returns {number|null} EMA value or null if not enough data
 */
export function calculateEMA(data, period) {
  if (data.length < period) return null;
  
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for first EMA value
  const sma = calculateSMA(data.slice(0, period), period);
  if (sma === null) return null;
  
  let ema = sma;
  
  // Calculate EMA for remaining data points
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param {number[]} closes - Close prices
 * @param {number} period - RSI period (default 14)
 * @returns {number|null} RSI value (0-100) or null if not enough data
 */
export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  
  const gains = changes.slice(-period).map(c => c > 0 ? c : 0);
  const losses = changes.slice(-period).map(c => c < 0 ? Math.abs(c) : 0);
  
  const avgGain = average(gains);
  const avgLoss = average(losses);
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}

/**
 * Calculate Average True Range (ATR)
 * @param {Array} ohlc - Array of {high, low, close} objects
 * @param {number} period - ATR period (default 14)
 * @returns {number|null} ATR value or null if not enough data
 */
export function calculateATR(ohlc, period = 14) {
  if (ohlc.length < period + 1) return null;
  
  const trueRanges = [];
  
  for (let i = 1; i < ohlc.length; i++) {
    const high = ohlc[i].high;
    const low = ohlc[i].low;
    const prevClose = ohlc[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }
  
  const recentTR = trueRanges.slice(-period);
  return average(recentTR);
}

/**
 * Calculate ATR as percentage of price
 * @param {Array} ohlc - Array of {high, low, close} objects
 * @param {number} period - ATR period
 * @returns {number|null} ATR percentage or null
 */
export function calculateATRPercent(ohlc, period = 14) {
  const atr = calculateATR(ohlc, period);
  if (atr === null) return null;
  
  const currentPrice = ohlc[ohlc.length - 1].close;
  return (atr / currentPrice) * 100;
}

/**
 * Calculate Z-Score for volume
 * @param {number[]} volumes - Volume data
 * @param {number} period - Lookback period
 * @returns {number|null} Z-Score or null if not enough data
 */
export function calculateZScore(volumes, period = 20) {
  if (volumes.length < period) return null;
  
  const recentVolumes = volumes.slice(-period);
  const currentVolume = volumes[volumes.length - 1];
  
  const mean = average(recentVolumes);
  const stdDev = standardDeviation(recentVolumes);
  
  if (stdDev === 0) return 0;
  
  return (currentVolume - mean) / stdDev;
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} data - Price data
 * @param {number} period - Period length
 * @param {number} stdDevMultiplier - Standard deviation multiplier (default 2)
 * @returns {Object|null} {upper, middle, lower} or null
 */
export function calculateBollingerBands(data, period = 20, stdDevMultiplier = 2) {
  if (data.length < period) return null;
  
  const sma = calculateSMA(data, period);
  const recentData = data.slice(-period);
  const stdDev = standardDeviation(recentData);
  
  return {
    upper: sma + (stdDev * stdDevMultiplier),
    middle: sma,
    lower: sma - (stdDev * stdDevMultiplier)
  };
}

/**
 * Check if there is a bullish crossover
 * @param {number[]} fastMA - Fast moving average data
 * @param {number[]} slowMA - Slow moving average data
 * @returns {boolean} True if bullish crossover
 */
export function isBullishCrossover(fastMA, slowMA) {
  if (fastMA.length < 2 || slowMA.length < 2) return false;
  
  const prevFast = fastMA[fastMA.length - 2];
  const currFast = fastMA[fastMA.length - 1];
  const prevSlow = slowMA[slowMA.length - 2];
  const currSlow = slowMA[slowMA.length - 1];
  
  return prevFast <= prevSlow && currFast > currSlow;
}

/**
 * Check if there is a bearish crossover
 * @param {number[]} fastMA - Fast moving average data
 * @param {number[]} slowMA - Slow moving average data
 * @returns {boolean} True if bearish crossover
 */
export function isBearishCrossover(fastMA, slowMA) {
  if (fastMA.length < 2 || slowMA.length < 2) return false;
  
  const prevFast = fastMA[fastMA.length - 2];
  const currFast = fastMA[fastMA.length - 1];
  const prevSlow = slowMA[slowMA.length - 2];
  const currSlow = slowMA[slowMA.length - 1];
  
  return prevFast >= prevSlow && currFast < currSlow;
}

