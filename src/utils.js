/**
 * Utility functions for the trading bot
 */

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Format number to fixed decimal places
 * @param {number} num - Number to format
 * @param {number} decimals - Decimal places
 * @returns {string}
 */
export function formatNumber(num, decimals = 2) {
  return num.toFixed(decimals);
}

/**
 * Format date to MySQL datetime string
 * @param {Date} date - Date object
 * @returns {string}
 */
export function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get current date in MySQL date format (YYYY-MM-DD)
 * @returns {string}
 */
export function getCurrentDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculate percentage change
 * @param {number} oldValue - Old value
 * @param {number} newValue - New value
 * @returns {number} Percentage change
 */
export function percentageChange(oldValue, newValue) {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Log with timestamp
 * @param {string} message - Message to log
 * @param {string} level - Log level (INFO, WARN, ERROR)
 */
export function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const colors = {
    INFO: '\x1b[36m',    // Cyan
    WARN: '\x1b[33m',    // Yellow
    ERROR: '\x1b[31m',   // Red
    SUCCESS: '\x1b[32m', // Green
    RESET: '\x1b[0m'     // Reset
  };
  
  const color = colors[level] || colors.INFO;
  console.log(`${color}[${timestamp}] [${level}]${colors.RESET} ${message}`);
}

/**
 * Safe division (returns 0 if denominator is 0)
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
export function safeDivide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Round to tick size (exchange precision)
 * @param {number} value - Value to round
 * @param {number} tickSize - Tick size (e.g., 0.01)
 * @returns {number}
 */
export function roundToTick(value, tickSize = 0.01) {
  return Math.round(value / tickSize) * tickSize;
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delayMs - Initial delay in milliseconds
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, maxRetries = 3, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const waitTime = delayMs * Math.pow(2, i);
      log(`Retry ${i + 1}/${maxRetries} after ${waitTime}ms: ${error.message}`, 'WARN');
      await sleep(waitTime);
    }
  }
}

/**
 * Calculate average of array
 * @param {number[]} arr - Array of numbers
 * @returns {number}
 */
export function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate standard deviation
 * @param {number[]} arr - Array of numbers
 * @returns {number}
 */
export function standardDeviation(arr) {
  if (arr.length === 0) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

