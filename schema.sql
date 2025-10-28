-- Kraken AI Trader Database Schema
-- Create database
CREATE DATABASE IF NOT EXISTS kraken_trader;
USE kraken_trader;

-- Trades table: stores all trade history
CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    side ENUM('BUY', 'SELL') NOT NULL,
    qty DECIMAL(18, 8) NOT NULL,
    entry_price DECIMAL(18, 8) NOT NULL,
    exit_price DECIMAL(18, 8) DEFAULT NULL,
    entry_fee DECIMAL(18, 8) DEFAULT 0,
    exit_fee DECIMAL(18, 8) DEFAULT 0,
    total_fees DECIMAL(18, 8) DEFAULT 0,
    pnl DECIMAL(18, 8) DEFAULT NULL,
    pnl_pct DECIMAL(10, 4) DEFAULT NULL,
    pnl_net DECIMAL(18, 8) DEFAULT NULL,
    balance_before DECIMAL(18, 8) DEFAULT NULL,
    balance_after DECIMAL(18, 8) DEFAULT NULL,
    net_balance_change DECIMAL(18, 8) DEFAULT NULL,
    ai_confidence DECIMAL(5, 4) DEFAULT NULL,
    atr_pct DECIMAL(10, 4) DEFAULT NULL,
    stop_loss DECIMAL(18, 8) DEFAULT NULL,
    take_profit DECIMAL(18, 8) DEFAULT NULL,
    opened_at DATETIME NOT NULL,
    closed_at DATETIME DEFAULT NULL,
    exit_reason VARCHAR(50) DEFAULT NULL,
    candles_held INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_opened_at (opened_at),
    INDEX idx_closed_at (closed_at),
    INDEX idx_exit_reason (exit_reason)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily summary table: stores daily performance metrics
CREATE TABLE IF NOT EXISTS daily_summary (
    id INT AUTO_INCREMENT PRIMARY KEY,
    day DATE NOT NULL UNIQUE,
    trades INT DEFAULT 0,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    net_pnl DECIMAL(18, 8) DEFAULT 0,
    gross_profit DECIMAL(18, 8) DEFAULT 0,
    gross_loss DECIMAL(18, 8) DEFAULT 0,
    profit_factor DECIMAL(10, 4) DEFAULT 0,
    win_rate DECIMAL(5, 4) DEFAULT 0,
    max_drawdown DECIMAL(18, 8) DEFAULT 0,
    avg_win DECIMAL(18, 8) DEFAULT 0,
    avg_loss DECIMAL(18, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI weights table: stores AI learning progress
CREATE TABLE IF NOT EXISTS ai_weights (
    id INT AUTO_INCREMENT PRIMARY KEY,
    w_rsi DECIMAL(5, 4) NOT NULL,
    w_ema DECIMAL(5, 4) NOT NULL,
    w_atr DECIMAL(5, 4) NOT NULL,
    w_vol DECIMAL(5, 4) NOT NULL,
    rsi_oversold INT DEFAULT 38,
    rsi_overbought INT DEFAULT 62,
    atr_low_pct DECIMAL(5, 2) DEFAULT 0.4,
    atr_high_pct DECIMAL(5, 2) DEFAULT 2.0,
    performance_snapshot JSON DEFAULT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert initial AI weights
INSERT INTO ai_weights (w_rsi, w_ema, w_atr, w_vol, updated_at) 
VALUES (0.40, 0.30, 0.15, 0.15, NOW());

