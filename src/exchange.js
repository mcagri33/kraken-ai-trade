/**
 * Exchange operations using CCXT (Kraken)
 * Enhanced with CAD market discovery, XBT normalization, cost-based buying
 */

import ccxt from 'ccxt';
import { log, sleep } from './utils.js';
import { getState } from './stateManager.js';

let exchange = null;
let cachedCADMarkets = null;
const DEFAULT_TAKER_FEE = 0.0026; // 0.26% Kraken taker fee

/**
 * Initialize Kraken exchange
 * @param {Object} config - API configuration
 * @returns {Promise<void>}
 */
export async function initExchange(config) {
  try {
    exchange = new ccxt.kraken({
      apiKey: config.apiKey,
      secret: config.secret,
      enableRateLimit: true,
      options: {
        defaultType: 'spot'
      }
    });

    // Load markets with retry
    await retryExchangeCall(async () => {
      await exchange.loadMarkets();
    });

    // Discover CAD markets
    cachedCADMarkets = await discoverCADMarkets();
    log(`Found ${cachedCADMarkets.length} CAD markets: ${cachedCADMarkets.map(m => m.symbol).join(', ')}`, 'INFO');

    // Test connection
    const balance = await retryExchangeCall(async () => {
      return await exchange.fetchBalance();
    });
    
    log(`Exchange connected successfully`, 'SUCCESS');
  } catch (error) {
    log(`Exchange connection error: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get exchange instance
 * @returns {Object} CCXT exchange instance
 */
export function getExchange() {
  if (!exchange) {
    throw new Error('Exchange not initialized. Call initExchange first.');
  }
  return exchange;
}

/**
 * Fetch OHLCV data (minimum 220 candles for EMA200)
 * @param {string} symbol - Trading pair (e.g., 'BTC/CAD')
 * @param {string} timeframe - Timeframe (e.g., '1m')
 * @param {number} limit - Number of candles to fetch
 * @returns {Promise<Array>} Array of OHLCV data
 */
export async function fetchOHLCV(symbol, timeframe = '1m', limit = 220) {
  try {
    // Ensure we fetch at least 220 candles for EMA200
    const fetchLimit = Math.max(limit, 220);
    
    const ohlcv = await retryExchangeCall(async () => {
      await sleep(50); // Small delay to avoid rate limits
      return await exchange.fetchOHLCV(symbol, timeframe, undefined, fetchLimit);
    });

    if (!ohlcv || ohlcv.length === 0) {
      throw new Error(`No OHLCV data returned for ${symbol}`);
    }

    // Transform to more usable format
    return ohlcv.map(candle => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5]
    }));
  } catch (error) {
    log(`Error fetching OHLCV for ${symbol}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Fetch current ticker price
 * @param {string} symbol - Trading pair
 * @returns {Promise<Object>} Ticker data
 */
export async function fetchTicker(symbol) {
  try {
    const ticker = await retryExchangeCall(async () => {
      return await exchange.fetchTicker(symbol);
    });
    return ticker;
  } catch (error) {
    log(`Error fetching ticker for ${symbol}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get account balance
 * @param {string} currency - Currency code (e.g., 'CAD', 'BTC')
 * @returns {Promise<Object>} Balance info {free, used, total}
 */
export async function getBalance(currency = 'CAD') {
  try {
    const balance = await retryExchangeCall(async () => {
      return await exchange.fetchBalance();
    });

    return {
      free: balance.free[currency] || 0,
      used: balance.used[currency] || 0,
      total: balance.total[currency] || 0
    };
  } catch (error) {
    log(`Error fetching balance: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Place market buy order
 * @param {string} symbol - Trading pair
 * @param {number} amount - Amount to buy (in base currency)
 * @returns {Promise<Object>} Order info
 */
export async function marketBuy(symbol, amount) {
  try {
    // Validate amount parameter
    if (!amount || amount <= 0 || isNaN(amount)) {
      log(`❌ Invalid amount parameter: ${amount}`, 'ERROR');
      throw new Error(`Invalid buy amount: ${amount}`);
    }
    
    // Check for dry-run mode
    const botState = getState();
    if (botState.dryRun) {
      const ticker = await exchange.fetchTicker(symbol);
      const price = ticker.last;
      log(`[SIMULATION] BUY ${symbol} @ ${price.toFixed(2)} (dry-run mode)`, 'INFO');
      return { 
        id: `sim-buy-${Date.now()}`, 
        status: 'simulated',
        symbol: symbol,
        side: 'buy',
        amount: amount,
        price: price,
        filled: amount,
        timestamp: Date.now()
      };
    }
    
    log(`📥 Attempting to buy: ${amount} ${symbol}`, 'DEBUG');
    
    const order = await exchange.createMarketBuyOrder(symbol, amount);
    log(`Market BUY executed: ${symbol} ${order.filled || amount} @ ~${order.price || 'market'}`, 'SUCCESS');
    return order;
  } catch (error) {
    log(`Error placing buy order for ${symbol}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Place market sell order (sells entire position)
 * @param {string} symbol - Trading pair
 * @param {number} amount - Amount to sell (in base currency)
 * @returns {Promise<Object>} Order info with fees
 */
export async function marketSell(symbol, amount) {
  try {
    // Validate amount parameter
    if (!amount || amount <= 0 || isNaN(amount)) {
      log(`❌ Invalid amount parameter: ${amount}`, 'ERROR');
      throw new Error(`Invalid sell amount: ${amount}`);
    }
    
    // Check for dry-run mode
    const botState = getState();
    if (botState.dryRun) {
      const ticker = await exchange.fetchTicker(symbol);
      const price = ticker.last;
      log(`[SIMULATION] SELL ${symbol} @ ${price.toFixed(2)} (dry-run mode)`, 'INFO');
      return { 
        id: `sim-sell-${Date.now()}`, 
        status: 'simulated',
        symbol: symbol,
        side: 'sell',
        amount: amount,
        price: price,
        filled: amount,
        timestamp: Date.now()
      };
    }
    
    log(`📤 Attempting to sell: ${amount} ${symbol}`, 'DEBUG');
    
    // Get market info for rounding
    const market = await getMarketInfo(symbol);
    
    // Round to step size
    let roundedAmount = amount;
    if (market.limits && market.limits.amount && market.limits.amount.min) {
      // precision.amount can be scientific notation (1e-8) or decimal places (8)
      let stepSize = market.precision?.amount || 8;
      
      // Convert scientific notation to decimal places: 1e-8 -> 8
      if (typeof stepSize === 'number' && stepSize < 1) {
        stepSize = Math.abs(Math.round(Math.log10(stepSize)));
      }
      
      log(`   Step size: ${stepSize}, Min amount: ${market.limits.amount.min}`, 'DEBUG');
      
      // More precise rounding using toFixed
      roundedAmount = parseFloat(amount.toFixed(stepSize));
      
      // Check if rounded amount is below minimum - DON'T auto-adjust, throw error instead
      if (roundedAmount < market.limits.amount.min) {
        log(`❌ Amount ${amount} (rounded: ${roundedAmount}) is below minimum ${market.limits.amount.min}`, 'ERROR');
        throw new Error(`Order amount ${amount} is below minimum ${market.limits.amount.min} for ${symbol}`);
      }
    }
    
    log(`Market SELL: ${symbol} ${roundedAmount} (original: ${amount})`, 'INFO');
    
    const order = await retryExchangeCall(async () => {
      return await exchange.createMarketSellOrder(symbol, roundedAmount);
    });
    
    // Extract fee information
    const fee = extractFee(order);
    order.extractedFee = fee;
    
    log(`Market SELL executed: ${order.filled || 0} @ ${order.average || order.price || 'market'}, Fee: ${fee.cost} ${fee.currency}`, 'SUCCESS');
    return order;
  } catch (error) {
    log(`Error placing sell order for ${symbol}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Place limit order with stop loss and take profit
 * Note: Kraken may not support all order types, this is a best-effort implementation
 * @param {string} symbol - Trading pair
 * @param {string} side - 'buy' or 'sell'
 * @param {number} amount - Amount
 * @param {number} price - Limit price
 * @param {Object} params - Additional params (stopLoss, takeProfit)
 * @returns {Promise<Object>} Order info
 */
export async function placeLimitOrder(symbol, side, amount, price, params = {}) {
  try {
    const order = await exchange.createOrder(symbol, 'limit', side, amount, price, params);
    log(`Limit ${side.toUpperCase()}: ${symbol} ${amount} @ ${price}`, 'INFO');
    return order;
  } catch (error) {
    log(`Error placing limit order: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Place stop loss order
 * @param {string} symbol - Trading pair
 * @param {string} side - 'buy' or 'sell'
 * @param {number} amount - Amount
 * @param {number} stopPrice - Stop price
 * @returns {Promise<Object|null>} Order info or null if not supported
 */
export async function placeStopLoss(symbol, side, amount, stopPrice) {
  try {
    // Kraken uses 'stop-loss' order type
    const order = await exchange.createOrder(symbol, 'stop-loss', side, amount, stopPrice);
    log(`Stop Loss placed: ${symbol} ${side} @ ${stopPrice}`, 'INFO');
    return order;
  } catch (error) {
    log(`Stop loss not supported or error: ${error.message}`, 'WARN');
    return null;
  }
}

/**
 * Place take profit order
 * @param {string} symbol - Trading pair
 * @param {string} side - 'buy' or 'sell'
 * @param {number} amount - Amount
 * @param {number} takeProfitPrice - Take profit price
 * @returns {Promise<Object|null>} Order info or null if not supported
 */
export async function placeTakeProfit(symbol, side, amount, takeProfitPrice) {
  try {
    // Kraken uses 'take-profit' order type
    const order = await exchange.createOrder(symbol, 'take-profit', side, amount, takeProfitPrice);
    log(`Take Profit placed: ${symbol} ${side} @ ${takeProfitPrice}`, 'INFO');
    return order;
  } catch (error) {
    log(`Take profit not supported or error: ${error.message}`, 'WARN');
    return null;
  }
}

/**
 * Cancel an order
 * @param {string} orderId - Order ID
 * @param {string} symbol - Trading pair
 * @returns {Promise<Object>} Cancelled order info
 */
export async function cancelOrder(orderId, symbol) {
  try {
    const result = await exchange.cancelOrder(orderId, symbol);
    log(`Order cancelled: ${orderId}`, 'INFO');
    return result;
  } catch (error) {
    log(`Error cancelling order ${orderId}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get open orders
 * @param {string} symbol - Trading pair (optional)
 * @returns {Promise<Array>} Array of open orders
 */
export async function getOpenOrders(symbol = undefined) {
  try {
    const orders = await exchange.fetchOpenOrders(symbol);
    return orders;
  } catch (error) {
    log(`Error fetching open orders: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Calculate position size based on risk
 * @param {number} cadRisk - CAD amount to risk
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPrice - Stop loss price
 * @param {Object} market - Market info from exchange
 * @returns {number} Position size in base currency
 */
export function calculatePositionSize(cadRisk, entryPrice, stopLossPrice, market = null) {
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit === 0) return 0;
  
  let qty = cadRisk / riskPerUnit;
  
  // Round to market precision if available
  if (market && market.precision && market.precision.amount) {
    const precision = market.precision.amount;
    qty = Math.floor(qty * Math.pow(10, precision)) / Math.pow(10, precision);
  }
  
  return qty;
}

/**
 * Get market info
 * @param {string} symbol - Trading pair
 * @returns {Promise<Object>} Market information
 */
export async function getMarketInfo(symbol) {
  try {
    await exchange.loadMarkets();
    const market = exchange.market(symbol);
    return market;
  } catch (error) {
    log(`Error getting market info for ${symbol}: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Check if trading is allowed for symbol
 * @param {string} symbol - Trading pair
 * @returns {Promise<boolean>} True if trading is allowed
 */
export async function isTradingAllowed(symbol) {
  try {
    const market = await getMarketInfo(symbol);
    return market.active === true;
  } catch (error) {
    return false;
  }
}

/**
 * Get minimum order size
 * @param {string} symbol - Trading pair
 * @returns {Promise<number>} Minimum order size
 */
export async function getMinOrderSize(symbol) {
  try {
    const market = await getMarketInfo(symbol);
    return market.limits.amount.min || 0;
  } catch (error) {
    log(`Error getting min order size: ${error.message}`, 'WARN');
    return 0;
  }
}

/**
 * Retry exchange call with exponential backoff (100ms -> 250ms -> 500ms)
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retries (default 3)
 * @returns {Promise<any>}
 */
async function retryExchangeCall(fn, maxRetries = 3) {
  const delays = [100, 250, 500];
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = delays[i] || 500;
      log(`Retry ${i + 1}/${maxRetries} after ${delay}ms: ${error.message}`, 'WARN');
      await sleep(delay);
    }
  }
}

/**
 * Discover all CAD-quoted markets on Kraken
 * @returns {Promise<Array>} Array of CAD market objects
 */
async function discoverCADMarkets() {
  try {
    await exchange.loadMarkets();
    const markets = Object.values(exchange.markets);
    
    // Filter CAD markets, active, spot only
    const cadMarkets = markets.filter(m => 
      m.quote === 'CAD' && 
      m.active === true && 
      m.spot === true
    );
    
    // Sort by volume (if available) or use predefined order
    const priorityOrder = ['BTC', 'XBT', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT'];
    
    cadMarkets.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.base);
      const bIndex = priorityOrder.indexOf(b.base);
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
    
    return cadMarkets;
  } catch (error) {
    log(`Error discovering CAD markets: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Get CAD markets (cached or fetch)
 * @returns {Promise<Array>} Array of CAD markets
 */
export async function getCADMarkets() {
  if (cachedCADMarkets) return cachedCADMarkets;
  return await discoverCADMarkets();
}

/**
 * Normalize symbol (handle BTC/XBT conversion for Kraken)
 * @param {string} symbol - Symbol to normalize
 * @returns {Promise<string>} Normalized symbol
 */
export async function normalizeSymbol(symbol) {
  try {
    await exchange.loadMarkets();
    
    // Check if symbol exists as-is
    if (exchange.markets[symbol]) {
      return symbol;
    }
    
    // Try BTC -> XBT conversion
    if (symbol.includes('BTC')) {
      const xbtSymbol = symbol.replace('BTC', 'XBT');
      if (exchange.markets[xbtSymbol]) {
        log(`Normalized ${symbol} to ${xbtSymbol}`, 'INFO');
        return xbtSymbol;
      }
    }
    
    // Try XBT -> BTC conversion
    if (symbol.includes('XBT')) {
      const btcSymbol = symbol.replace('XBT', 'BTC');
      if (exchange.markets[btcSymbol]) {
        log(`Normalized ${symbol} to ${btcSymbol}`, 'INFO');
        return btcSymbol;
      }
    }
    
    // Return as-is if no conversion found
    log(`Symbol ${symbol} not found, using as-is`, 'WARN');
    return symbol;
  } catch (error) {
    log(`Error normalizing symbol: ${error.message}`, 'WARN');
    return symbol;
  }
}

/**
 * Validate and normalize symbols list
 * @param {Array<string>} symbols - Symbols to validate
 * @returns {Promise<Array<string>>} Valid normalized symbols
 */
export async function validateSymbols(symbols) {
  const validSymbols = [];
  const cadMarkets = await getCADMarkets();
  
  for (const symbol of symbols) {
    const normalized = await normalizeSymbol(symbol);
    const market = cadMarkets.find(m => m.symbol === normalized);
    
    if (market) {
      validSymbols.push(normalized);
      log(`✓ ${symbol} -> ${normalized} validated`, 'SUCCESS');
    } else {
      log(`✗ ${symbol} not found in CAD markets`, 'WARN');
    }
  }
  
  // If no valid symbols, use top 3 CAD markets
  if (validSymbols.length === 0 && cadMarkets.length > 0) {
    const top3 = cadMarkets.slice(0, 3).map(m => m.symbol);
    log(`No valid symbols provided, using top 3 CAD markets: ${top3.join(', ')}`, 'INFO');
    return top3;
  }
  
  return validSymbols;
}

/**
 * Market buy using cost (CAD amount) - Kraken supports this
 * @param {string} symbol - Trading pair
 * @param {number} cadAmount - CAD amount to spend
 * @returns {Promise<Object>} Order info with fees
 */
export async function marketBuyCost(symbol, cadAmount) {
  try {
    log(`Market BUY: ${symbol} with ${cadAmount.toFixed(2)} CAD`, 'INFO');
    
    // Check if purchase amount will result in minimum qty
    const market = await getMarketInfo(symbol);
    const ticker = await fetchTicker(symbol);
    const estimatedQty = cadAmount / ticker.last;
    
    if (market.limits?.amount?.min && estimatedQty < market.limits.amount.min) {
      const minCost = market.limits.amount.min * ticker.last;
      log(`❌ Purchase amount ${cadAmount} CAD would result in ${estimatedQty.toFixed(8)} ${symbol.split('/')[0]}, below minimum ${market.limits.amount.min}`, 'ERROR');
      throw new Error(`Minimum purchase is ${minCost.toFixed(2)} CAD to meet exchange minimum qty of ${market.limits.amount.min}`);
    }
    
    // Try cost-based buy first (Kraken supports this)
    let order;
    try {
      order = await retryExchangeCall(async () => {
        return await exchange.createOrder(symbol, 'market', 'buy', null, null, {
          cost: cadAmount
        });
      });
    } catch (costError) {
      // Fallback: calculate qty from ticker
      log(`Cost parameter not supported, using fallback`, 'WARN');
      
      order = await retryExchangeCall(async () => {
        return await exchange.createMarketBuyOrder(symbol, estimatedQty);
      });
    }
    
    // Debug: Log full order response
    log(`Order response debug: filled=${order.filled}, amount=${order.amount}, cost=${order.cost}, ` +
        `info.vol=${order.info?.vol}, info.cost=${order.info?.cost}`, 'DEBUG');
    
    // Extract quantity from various possible fields
    const actualQty = order.filled || order.amount || parseFloat(order.info?.vol) || 0;
    const actualPrice = order.average || order.price || parseFloat(order.info?.price) || 0;
    const actualCost = order.cost || parseFloat(order.info?.cost) || 0;
    
    // Override order fields with extracted values
    if (!order.filled && actualQty > 0) {
      order.filled = actualQty;
      log(`Order.filled was missing, extracted: ${actualQty}`, 'WARN');
    }
    if (!order.average && actualPrice > 0) {
      order.average = actualPrice;
    }
    if (!order.cost && actualCost > 0) {
      order.cost = actualCost;
    }
    
    // Extract fee information
    const fee = extractFee(order);
    order.extractedFee = fee;
    
    log(`Market BUY executed: ${order.filled || 0} @ ${order.average || order.price || 'market'}, Fee: ${fee.cost} ${fee.currency}`, 'SUCCESS');
    return order;
  } catch (error) {
    log(`Error in market buy with cost: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Extract fee from order
 * @param {Object} order - Order object from CCXT
 * @returns {Object} Fee object {cost, currency}
 */
function extractFee(order) {
  if (order.fee && order.fee.cost) {
    return {
      cost: order.fee.cost,
      currency: order.fee.currency || 'CAD'
    };
  }
  
  // Estimate fee if not provided (Kraken taker fee ~0.26%)
  const estimatedFeeCost = (order.cost || 0) * DEFAULT_TAKER_FEE;
  log(`Fee not provided by exchange, estimated: ${estimatedFeeCost.toFixed(4)} CAD`, 'WARN');
  
  return {
    cost: estimatedFeeCost,
    currency: 'CAD',
    estimated: true
  };
}

/**
 * Get CAD balance with robust fallback handling
 * Handles different Kraken API response formats
 * @returns {Promise<number>} CAD balance
 */
export async function getRobustCADBalance() {
  try {
    const balance = await retryExchangeCall(async () => {
      return await exchange.fetchBalance();
    });
    
    // Try multiple possible balance structures
    const cadBalance = 
      balance.total?.CAD ??           // Standard CCXT format
      balance.free?.CAD ??            // Free balance format
      balance.used?.CAD ??            // Used balance format
      balance.info?.CAD ??            // Raw info format
      balance.CAD ??                  // Direct CAD field
      balance['CAD'] ??               // String key format
      0;                              // Fallback to 0
    
    log(`💰 Robust CAD balance: ${cadBalance.toFixed(2)} CAD (from ${Object.keys(balance).join(', ')})`, 'DEBUG');
    return parseFloat(cadBalance) || 0;
    
  } catch (error) {
    log(`⚠️ Error fetching CAD balance: ${error.message}`, 'WARN');
    return 0;
  }
}

/**
 * Get all base currency balances (for single position check)
 * @returns {Promise<Object>} Balances by currency
 */
export async function getAllBaseBalances() {
  try {
    const balance = await retryExchangeCall(async () => {
      return await exchange.fetchBalance();
    });
    
    const bases = {};
    for (const [currency, amounts] of Object.entries(balance)) {
      // Skip special keys and validate amounts is an object
      if (currency !== 'free' && 
          currency !== 'used' && 
          currency !== 'total' && 
          currency !== 'info' && 
          currency !== 'timestamp' && 
          currency !== 'datetime' &&
          typeof amounts === 'object' && 
          amounts !== null) {
        
        // Safely extract values with null checks
        const free = parseFloat(amounts.free) || 0;
        const used = parseFloat(amounts.used) || 0;
        const total = parseFloat(amounts.total) || 0;
        
        // Only add if there's actual balance
        if (free > 0 || used > 0 || total > 0) {
          bases[currency] = { free, used, total };
        }
      }
    }
    
    // Remove CAD from bases (it's our quote currency)
    delete bases.CAD;
    
    return bases;
  } catch (error) {
    log(`Error fetching base balances: ${error.message}`, 'ERROR');
    return {};
  }
}

/**
 * Get current fee rates from Kraken API
 * @returns {Promise<Object>} Fee rates {taker, maker}
 */
export async function getFeeRates() {
  try {
    const fees = await exchange.fetchTradingFees();
    return { taker: fees.taker || 0.0026, maker: fees.maker || 0.0016 };
  } catch {
    // fallback
    return { taker: 0.0026, maker: 0.0016 };
  }
}

/**
 * Convert small amounts of crypto to CAD (dust cleanup)
 * Uses Kraken's Convert API to bypass minimum order limits
 * @param {string} fromCurrency - Source currency (e.g., 'BTC')
 * @param {string} toCurrency - Target currency (e.g., 'CAD')
 * @returns {Promise<Object|null>} Conversion result or null if not supported
 */
export async function convert(fromCurrency, toCurrency) {
  try {
    // Check if Kraken convert API is supported by CCXT
    if (!exchange.has['convert'] || typeof exchange.convertTrade !== 'function') {
      log('⚠️ Kraken convert API not supported by CCXT. Skipping dust cleanup.', 'WARN');
      return null;
    }

    const symbol = `${fromCurrency}/${toCurrency}`;
    
    // Get current balance
    const balance = await getBalance(fromCurrency);
    if (balance.total <= 0) {
      return null;
    }
    
    // Get current price for CAD value calculation
    const ticker = await fetchTicker(symbol);
    const cadValue = balance.total * ticker.last;
    
    log(`🔄 Attempting to convert ${balance.total.toFixed(8)} ${fromCurrency} (${cadValue.toFixed(2)} CAD)`, 'INFO');
    
    // Try Kraken's Convert API first (bypasses minimum limits)
    try {
      // Method 1: Kraken'ın doğru ConvertTrade endpoint'i
      const convertTradeResult = await retryExchangeCall(async () => {
        return await exchange.convertTrade({
          pair: symbol,
          type: 'sell',
          volume: balance.total.toString()
        });
      });
      
      if (convertTradeResult && convertTradeResult.result) {
        const cost = parseFloat(convertTradeResult.result.cost);
        log(`✅ ConvertTrade success: ${balance.total.toFixed(8)} ${fromCurrency} → ${cost.toFixed(2)} ${toCurrency}`, 'SUCCESS');
        return {
          amount: balance.total,
          cost: cost,
          order: convertTradeResult
        };
      }
    } catch (convertTradeError) {
      log(`⚠️ ConvertTrade failed: ${convertTradeError.message}`, 'WARN');
    }
    
    // Method 2: Kraken'ın Trade endpoint'i ile convert
    try {
      const tradeResult = await retryExchangeCall(async () => {
        return await exchange.createOrder(symbol, 'market', 'sell', balance.total, null, null, {
          convert: true
        });
      });
      
      if (tradeResult && tradeResult.result) {
        const cost = parseFloat(tradeResult.result.cost);
        log(`✅ Trade convert success: ${balance.total.toFixed(8)} ${fromCurrency} → ${cost.toFixed(2)} ${toCurrency}`, 'SUCCESS');
        return {
          amount: balance.total,
          cost: cost,
          order: tradeResult
        };
      }
    } catch (tradeError) {
      log(`⚠️ Trade convert failed: ${tradeError.message}`, 'WARN');
    }
    
    // Method 3: Kraken'ın Convert endpoint'i (fallback)
    try {
      const convertResult = await retryExchangeCall(async () => {
        return await exchange.convert({
          pair: symbol,
          amount: balance.total.toString(),
          from: fromCurrency,
          to: toCurrency
        });
      });
      
      if (convertResult && convertResult.result) {
        const convertedAmount = parseFloat(convertResult.result.converted);
        log(`✅ Convert API success: ${balance.total.toFixed(8)} ${fromCurrency} → ${convertedAmount.toFixed(2)} ${toCurrency}`, 'SUCCESS');
        return {
          amount: balance.total,
          cost: convertedAmount,
          order: convertResult
        };
      }
    } catch (convertError) {
      log(`⚠️ Convert endpoint failed: ${convertError.message}`, 'WARN');
    }
    
    // Method 4: Fallback to regular market sell (with minimum check)
    try {
      // Check minimum amount before attempting market sell
      const marketInfo = await exchange.loadMarkets();
      const market = marketInfo[symbol];
      const minAmount = market.limits.amount.min;
      
      if (balance.total >= minAmount) {
        const order = await marketSell(symbol, balance.total);
        
        log(`✅ Regular market sell success: ${balance.total.toFixed(8)} ${fromCurrency} → ${order.cost.toFixed(2)} ${toCurrency}`, 'SUCCESS');
        return {
          amount: balance.total,
          cost: order.cost,
          order: order
        };
      } else {
        log(`⚠️ Amount ${balance.total.toFixed(8)} below minimum ${minAmount}, skipping regular sell`, 'WARN');
      }
      
    } catch (marketSellError) {
      log(`⚠️ Market sell failed: ${marketSellError.message}`, 'WARN');
    }

    log(`❌ All convert methods failed for ${balance.total.toFixed(8)} ${fromCurrency}`, 'ERROR');
    
    // Log the dust amount for manual cleanup
    log(`💡 Manual cleanup needed: ${balance.total.toFixed(8)} ${fromCurrency} (${cadValue.toFixed(2)} CAD)`, 'WARN');
    
    return null;
    
  } catch (error) {
    log(`Error converting ${fromCurrency} to ${toCurrency}: ${error.message}`, 'WARN');
    return null;
  }
}

/**
 * Check if we have any open positions (non-CAD balances > dust)
 * @param {number} dustThreshold - Minimum value in CAD to consider (default 1 CAD)
 * @returns {Promise<boolean>} True if has position
 */
export async function hasOpenPosition(dustThreshold = 1.0) {
  try {
    const bases = await getAllBaseBalances();
    
    for (const [currency, amounts] of Object.entries(bases)) {
      if (amounts.total > 0) {
        // Try to get CAD value (rough estimate)
        try {
          const symbol = `${currency}/CAD`;
          const ticker = await fetchTicker(symbol);
          const cadValue = amounts.total * ticker.last;
          
          if (cadValue > dustThreshold) {
            log(`Open position detected: ${amounts.total} ${currency} (~${cadValue.toFixed(2)} CAD)`, 'INFO');
            return true;
          }
        } catch (err) {
          // Symbol might not exist, skip
        }
      }
    }
    
    return false;
  } catch (error) {
    log(`Error checking open positions: ${error.message}`, 'WARN');
    return false;
  }
}

