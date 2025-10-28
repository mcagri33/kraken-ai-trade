/**
 * Database operations using MySQL
 */

import mysql from 'mysql2/promise';
import { log, getCurrentDate, formatDate } from './utils.js';

let pool = null;

/**
 * Initialize database connection pool
 * @param {Object} config - Database configuration
 * @returns {Promise<void>}
 */
export async function initDB(config) {
  try {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test connection
    const conn = await pool.getConnection();
    log('Database connected successfully', 'SUCCESS');
    conn.release();
  } catch (error) {
    log(`Database connection error: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get database connection pool
 * @returns {Object} MySQL pool
 */
export function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDB first.');
  }
  return pool;
}

/**
 * Close database connection
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (pool) {
    await pool.end();
    log('Database connection closed', 'INFO');
  }
}

// ==================== TRADES TABLE OPERATIONS ====================

/**
 * Insert a new trade with fee tracking
 * @param {Object} trade - Trade data
 * @returns {Promise<number>} Inserted trade ID
 */
export async function insertTrade(trade) {
  const query = `
    INSERT INTO trades (
      symbol, side, qty, entry_price, entry_fee, ai_confidence, 
      atr_pct, stop_loss, take_profit, balance_before, opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  // Null guards
  const values = [
    trade.symbol || '',
    trade.side || 'BUY',
    parseFloat(trade.qty) || 0,
    parseFloat(trade.entry_price) || 0,
    parseFloat(trade.entry_fee) || 0,
    parseFloat(trade.ai_confidence) || 0,
    parseFloat(trade.atr_pct) || 0,
    parseFloat(trade.stop_loss) || 0,
    parseFloat(trade.take_profit) || 0,
    parseFloat(trade.balance_before) || 0,
    formatDate(trade.opened_at || new Date())
  ];
  
  const [result] = await pool.execute(query, values);
  log(`Trade inserted: ${trade.symbol} ${trade.side} ${trade.qty} @ ${trade.entry_price}, Fee: ${trade.entry_fee || 0}`, 'SUCCESS');
  return result.insertId;
}

/**
 * Update trade on exit with fee tracking and transaction
 * @param {number} tradeId - Trade ID
 * @param {Object} exitData - Exit data
 * @returns {Promise<void>}
 */
export async function updateTradeExit(tradeId, exitData) {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Null guards
    const exitPrice = parseFloat(exitData.exit_price) || 0;
    const exitFee = parseFloat(exitData.exit_fee) || 0;
    const pnl = parseFloat(exitData.pnl) || 0;
    const pnlPct = parseFloat(exitData.pnl_pct) || 0;
    const candlesHeld = parseInt(exitData.candles_held) || 0;
    
    // Get entry fee
    const [rows] = await connection.execute(
      'SELECT entry_fee FROM trades WHERE id = ?',
      [tradeId]
    );
    
    const entryFee = rows.length > 0 ? parseFloat(rows[0].entry_fee) || 0 : 0;
    const totalFees = entryFee + exitFee;
    const pnlNet = pnl - totalFees;
    
    const query = `
      UPDATE trades 
      SET exit_price = ?, exit_fee = ?, total_fees = ?, 
          pnl = ?, pnl_pct = ?, pnl_net = ?,
          balance_before = ?, balance_after = ?, net_balance_change = ?,
          closed_at = ?, exit_reason = ?, candles_held = ?
      WHERE id = ?
    `;
    
    const values = [
      exitPrice,
      exitFee,
      totalFees,
      pnl,
      pnlPct,
      pnlNet,
      parseFloat(exitData.balance_before) || 0,
      parseFloat(exitData.balance_after) || 0,
      parseFloat(exitData.net_balance_change) || 0,
      formatDate(exitData.closed_at || new Date()),
      exitData.exit_reason || 'UNKNOWN',
      candlesHeld,
      tradeId
    ];
    
    await connection.execute(query, values);
    await connection.commit();
    
    log(`Trade closed: ID=${tradeId}, PnL=${pnl.toFixed(2)} CAD (${pnlPct.toFixed(2)}%), Net=${pnlNet.toFixed(2)} CAD after fees`, 
        pnlNet > 0 ? 'SUCCESS' : 'WARN');
  } catch (error) {
    await connection.rollback();
    log(`Error updating trade exit: ${error.message}`, 'ERROR');
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get open trades
 * @param {string} symbol - Optional symbol filter
 * @returns {Promise<Array>} Open trades
 */
export async function getOpenTrades(symbol = null) {
  let query = 'SELECT * FROM trades WHERE closed_at IS NULL';
  const values = [];
  
  if (symbol) {
    query += ' AND symbol = ?';
    values.push(symbol);
  }
  
  const [rows] = await pool.execute(query, values);
  return rows;
}

/**
 * Get trades for today
 * @returns {Promise<Array>} Today's trades
 */
export async function getTodayTrades() {
  const query = `
    SELECT * FROM trades 
    WHERE DATE(opened_at) = ?
    ORDER BY opened_at DESC
  `;
  
  const [rows] = await pool.execute(query, [getCurrentDate()]);
  return rows;
}

/**
 * Get closed trades count for today
 * @returns {Promise<number>} Number of closed trades today
 */
export async function getTodayClosedTradesCount() {
  const query = `
    SELECT COUNT(*) as count 
    FROM trades 
    WHERE DATE(closed_at) = ? AND closed_at IS NOT NULL
  `;
  
  const [rows] = await pool.execute(query, [getCurrentDate()]);
  return rows[0].count;
}

/**
 * Get trade by ID
 * @param {number} tradeId - Trade ID
 * @returns {Promise<Object|null>} Trade data or null
 */
export async function getTradeById(tradeId) {
  const query = `
    SELECT * FROM trades 
    WHERE id = ?
  `;
  
  const [rows] = await pool.execute(query, [tradeId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get last closed trade with balance data
 * @returns {Promise<Object|null>} Last closed trade or null
 */
export async function getLastClosedTrade() {
  const query = `
    SELECT * FROM trades 
    WHERE closed_at IS NOT NULL 
    ORDER BY closed_at DESC 
    LIMIT 1
  `;
  
  const [rows] = await pool.execute(query);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get today's total net balance change (real wallet changes)
 * @returns {Promise<number>} Total net balance change for today
 */
export async function getTodayNetBalanceChange() {
  const query = `
    SELECT COALESCE(SUM(net_balance_change), 0) as total_balance_change 
    FROM trades 
    WHERE DATE(closed_at) = ? AND net_balance_change IS NOT NULL
  `;
  
  const [rows] = await pool.execute(query, [getCurrentDate()]);
  return parseFloat(rows[0].total_balance_change);
}

/**
 * Get today's total PnL
 * @returns {Promise<number>} Total PnL for today
 */
export async function getTodayPnL() {
  const query = `
    SELECT COALESCE(SUM(pnl), 0) as total_pnl 
    FROM trades 
    WHERE DATE(closed_at) = ? AND pnl IS NOT NULL
  `;
  
  const [rows] = await pool.execute(query, [getCurrentDate()]);
  return parseFloat(rows[0].total_pnl);
}

/**
 * Get last closed trade time
 * @returns {Promise<Date|null>} Last closed trade time or null
 */
export async function getLastClosedTradeTime() {
  const query = `
    SELECT closed_at 
    FROM trades 
    WHERE closed_at IS NOT NULL 
    ORDER BY closed_at DESC 
    LIMIT 1
  `;
  
  const [rows] = await pool.execute(query);
  return rows.length > 0 ? rows[0].closed_at : null;
}

// ==================== DAILY SUMMARY TABLE OPERATIONS ====================

/**
 * Update or insert daily summary
 * @param {string} day - Date string (YYYY-MM-DD)
 * @returns {Promise<void>}
 */
export async function updateDailySummary(day = getCurrentDate()) {
  // Calculate metrics from closed trades
  const query = `
    SELECT 
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses,
      COALESCE(SUM(pnl), 0) as net_pnl,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END), 0) as gross_profit,
      COALESCE(SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END), 0) as gross_loss
    FROM trades 
    WHERE DATE(closed_at) = ? AND closed_at IS NOT NULL
  `;
  
  const [rows] = await pool.execute(query, [day]);
  const data = rows[0];
  
  const winRate = data.trades > 0 ? data.wins / data.trades : 0;
  const profitFactor = data.gross_loss > 0 ? data.gross_profit / data.gross_loss : 0;
  const avgWin = data.wins > 0 ? data.gross_profit / data.wins : 0;
  const avgLoss = data.losses > 0 ? data.gross_loss / data.losses : 0;
  
  // Calculate max drawdown (simplified - running total)
  const ddQuery = `
    SELECT pnl FROM trades 
    WHERE DATE(closed_at) = ? AND closed_at IS NOT NULL
    ORDER BY closed_at ASC
  `;
  const [trades] = await pool.execute(ddQuery, [day]);
  
  let maxDD = 0;
  let runningPnL = 0;
  let peak = 0;
  
  for (const trade of trades) {
    runningPnL += parseFloat(trade.pnl);
    if (runningPnL > peak) peak = runningPnL;
    const drawdown = peak - runningPnL;
    if (drawdown > maxDD) maxDD = drawdown;
  }
  
  // Insert or update
  const upsertQuery = `
    INSERT INTO daily_summary 
      (day, trades, wins, losses, net_pnl, gross_profit, gross_loss, 
       profit_factor, win_rate, max_drawdown, avg_win, avg_loss)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      trades = VALUES(trades),
      wins = VALUES(wins),
      losses = VALUES(losses),
      net_pnl = VALUES(net_pnl),
      gross_profit = VALUES(gross_profit),
      gross_loss = VALUES(gross_loss),
      profit_factor = VALUES(profit_factor),
      win_rate = VALUES(win_rate),
      max_drawdown = VALUES(max_drawdown),
      avg_win = VALUES(avg_win),
      avg_loss = VALUES(avg_loss)
  `;
  
  await pool.execute(upsertQuery, [
    day,
    data.trades,
    data.wins,
    data.losses,
    data.net_pnl,
    data.gross_profit,
    data.gross_loss,
    profitFactor,
    winRate,
    maxDD,
    avgWin,
    avgLoss
  ]);
}

/**
 * Get daily summary for a specific day
 * @param {string} day - Date string (YYYY-MM-DD)
 * @returns {Promise<Object|null>} Daily summary or null
 */
export async function getDailySummary(day = getCurrentDate()) {
  const query = 'SELECT * FROM daily_summary WHERE day = ?';
  const [rows] = await pool.execute(query, [day]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get recent daily summaries
 * @param {number} days - Number of days to fetch
 * @returns {Promise<Array>} Array of daily summaries
 */
export async function getRecentSummaries(days = 7) {
  // Ensure days is a safe integer
  const safeDays = parseInt(days) || 7;
  
  // Use direct interpolation for LIMIT (safe since we validate the input)
  const query = `
    SELECT * FROM daily_summary 
    ORDER BY day DESC 
    LIMIT ${safeDays}
  `;
  const [rows] = await pool.execute(query);
  return rows;
}

// ==================== AI WEIGHTS TABLE OPERATIONS ====================

/**
 * Get latest AI weights
 * @returns {Promise<Object|null>} Latest weights or null
 */
export async function getLatestWeights() {
  const query = `
    SELECT * FROM ai_weights 
    ORDER BY updated_at DESC 
    LIMIT 1
  `;
  const [rows] = await pool.execute(query);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Insert new AI weights
 * @param {Object} weights - Weights data
 * @returns {Promise<number>} Inserted ID
 */
export async function insertWeights(weights) {
  const query = `
    INSERT INTO ai_weights 
      (w_rsi, w_ema, w_atr, w_vol, rsi_oversold, rsi_overbought, 
       atr_low_pct, atr_high_pct, performance_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const values = [
    weights.w_rsi,
    weights.w_ema,
    weights.w_atr,
    weights.w_vol,
    weights.rsi_oversold,
    weights.rsi_overbought,
    weights.atr_low_pct,
    weights.atr_high_pct,
    weights.performance_snapshot ? JSON.stringify(weights.performance_snapshot) : null
  ];
  
  const [result] = await pool.execute(query, values);
  log('AI weights updated', 'INFO');
  return result.insertId;
}

/**
 * Get AI weights history
 * @param {number} limit - Number of records to fetch
 * @returns {Promise<Array>} Array of weight records
 */
export async function getWeightsHistory(limit = 10) {
  // Ensure limit is a safe integer to prevent SQL injection
  const safeLimit = parseInt(limit) || 10;
  
  // Use direct interpolation for LIMIT (safe since we validate the input)
  // MySQL prepared statements sometimes have issues with LIMIT parameters
  const query = `
    SELECT * FROM ai_weights 
    ORDER BY updated_at DESC 
    LIMIT ${safeLimit}
  `;
  const [rows] = await pool.execute(query);
  return rows;
}

/**
 * Migrate missing balance_before values in historical trades
 * This function fills missing balance_before values by calculating backwards from the last known balance
 * @returns {Promise<Object>} Migration results
 */
export async function migrateMissingBalanceBefore() {
  try {
    log('🔄 Starting balance_before migration for historical trades...', 'INFO');
    
    // Get all trades ordered by opened_at (oldest first)
    const query = `
      SELECT id, symbol, side, qty, entry_price, exit_price, entry_fee, exit_fee, 
             opened_at, closed_at, pnl_net, net_balance_change
      FROM trades 
      WHERE closed_at IS NOT NULL
      ORDER BY opened_at ASC
    `;
    const [trades] = await pool.execute(query);
    
    if (trades.length === 0) {
      log('📊 No historical trades found for migration', 'INFO');
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    // Get the most recent trade with valid balance data
    const lastValidQuery = `
      SELECT balance_after, closed_at
      FROM trades 
      WHERE balance_after IS NOT NULL AND balance_after > 0
      ORDER BY closed_at DESC 
      LIMIT 1
    `;
    const [lastValidRows] = await pool.execute(lastValidQuery);
    
    if (lastValidRows.length === 0) {
      log('⚠️ No valid balance_after found, cannot perform migration', 'WARN');
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    const lastValidBalance = parseFloat(lastValidRows[0].balance_after);
    const lastValidDate = new Date(lastValidRows[0].closed_at);
    
    log(`💰 Last valid balance: ${lastValidBalance.toFixed(2)} CAD (${lastValidDate.toISOString()})`, 'INFO');
    
    // Calculate balance backwards from the last known balance
    let currentBalance = lastValidBalance;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process trades in reverse chronological order (newest to oldest)
    const reversedTrades = [...trades].reverse();
    
    for (const trade of reversedTrades) {
      try {
        // Skip if balance_before already exists
        const checkQuery = `SELECT balance_before FROM trades WHERE id = ?`;
        const [checkRows] = await pool.execute(checkQuery, [trade.id]);
        
        if (checkRows.length > 0 && checkRows[0].balance_before !== null) {
          skippedCount++;
          continue;
        }
        
        // Calculate balance_before by subtracting net_balance_change
        let calculatedBalanceBefore = currentBalance;
        
        // If we have net_balance_change, use it; otherwise calculate from PnL
        if (trade.net_balance_change !== null) {
          calculatedBalanceBefore = currentBalance - parseFloat(trade.net_balance_change);
        } else if (trade.pnl_net !== null) {
          // Fallback: estimate from PnL (less accurate)
          calculatedBalanceBefore = currentBalance - parseFloat(trade.pnl_net);
        }
        
        // Ensure balance is not negative
        calculatedBalanceBefore = Math.max(0, calculatedBalanceBefore);
        
        // Update the trade record
        const updateQuery = `
          UPDATE trades 
          SET balance_before = ?, balance_after = ?
          WHERE id = ?
        `;
        
        const balanceAfter = currentBalance;
        
        await pool.execute(updateQuery, [
          calculatedBalanceBefore,
          balanceAfter,
          trade.id
        ]);
        
        log(`✅ Migrated trade ${trade.id}: balance_before=${calculatedBalanceBefore.toFixed(2)}, balance_after=${balanceAfter.toFixed(2)}`, 'DEBUG');
        
        // Update current balance for next iteration
        currentBalance = calculatedBalanceBefore;
        updatedCount++;
        
      } catch (error) {
        log(`❌ Error migrating trade ${trade.id}: ${error.message}`, 'ERROR');
        errorCount++;
      }
    }
    
    const result = {
      updated: updatedCount,
      skipped: skippedCount,
      errors: errorCount,
      total: trades.length
    };
    
    log(`🎯 Migration completed: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`, 'SUCCESS');
    
    return result;
    
  } catch (error) {
    log(`❌ Migration failed: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Get migration statistics
 * @returns {Promise<Object>} Migration statistics
 */
export async function getMigrationStats() {
  try {
    const query = `
      SELECT 
        COUNT(*) as total_trades,
        COUNT(balance_before) as trades_with_balance_before,
        COUNT(*) - COUNT(balance_before) as trades_missing_balance_before,
        COUNT(balance_after) as trades_with_balance_after,
        COUNT(*) - COUNT(balance_after) as trades_missing_balance_after
      FROM trades 
      WHERE closed_at IS NOT NULL
    `;
    
    const [rows] = await pool.execute(query);
    const stats = rows[0];
    
    return {
      totalTrades: parseInt(stats.total_trades),
      tradesWithBalanceBefore: parseInt(stats.trades_with_balance_before),
      tradesMissingBalanceBefore: parseInt(stats.trades_missing_balance_before),
      tradesWithBalanceAfter: parseInt(stats.trades_with_balance_after),
      tradesMissingBalanceAfter: parseInt(stats.trades_missing_balance_after),
      migrationNeeded: parseInt(stats.trades_missing_balance_before) > 0
    };
    
  } catch (error) {
    log(`Error getting migration stats: ${error.message}`, 'ERROR');
    throw error;
  }
}

