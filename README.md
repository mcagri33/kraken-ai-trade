# 🤖 Kraken AI Trading Bot - Güncel Özellikler

## 📊 Genel Bakış
- **Platform:** Kraken Exchange (CAD Spot Markets)
- **Strateji:** AI-Powered Adaptive Scalper + Fee-Aware Trading
- **Risk Yönetimi:** Dinamik Stop Loss & Take Profit + Orphaned Positions Cleanup
- **Bildirimler:** Telegram Bot Integration + Real-time Alerts
- **Veritabanı:** MySQL/MariaDB + Auto-sync
- **PnL System:** Gerçek Kraken Bakiyesi Uyumlu

---

## 🧠 AI & Machine Learning

### ⚖️ AI Ağırlıkları
- **RSI:** 40% (Momentum)
- **EMA:** 30% (Trend)
- **ATR:** 15% (Volatilite)
- **Volume:** 15% (Hacim)

### 🔄 Adaptive Learning
- **Otomatik Optimizasyon:** Her 12 saatte bir
- **Performance Tracking:** Win Rate & Profit Factor
- **Dynamic Parameters:** Piyasa koşullarına göre ayarlama
- **Learning Rate:** 0.03 (Yavaş ve stabil öğrenme)

---

## 🎯 Trading Stratejisi

### 📈 Entry Conditions (BUY)
- **Regime Filter:** Price > EMA200 (Bullish Market)
- **Trend Filter:** EMA20 > EMA50 (Uptrend)
- **RSI Oversold:** RSI < 35 (Oversold Condition)
- **Volatility:** ATR% in acceptable range (0.01% - 2.0%)
- **Volume:** Volume Z-Score > -1.0 (Strong Volume)
- **Confidence:** AI Confidence > 0.200 (Adaptive Threshold)

### 📉 Exit Conditions (SELL)
- **RSI Overbought:** RSI > 65
- **Bearish Regime:** Price < EMA200
- **Trailing Stop:** Dynamic ATR-based stop loss
- **Take Profit:** 1.5x ATR multiplier

---

## 🧠 Adaptive Scalper Mode

### 📊 Volatility-Based Adaptation
```javascript
// Low Volatility (ATR < 0.05%)
Confidence Threshold: 0.200 (Gevşetilmiş)
ATR Low PCT: 0.01 (Agresif)

// Medium Volatility (0.05% - 0.1%)
Confidence Threshold: 0.275 (Orta)
ATR Low PCT: 0.0075 (Orta)

// High Volatility (0.1% - 0.2%)
Confidence Threshold: 0.350 (Konservatif)
ATR Low PCT: 0.0125 (Konservatif)

// Extreme Volatility (> 0.2%)
Confidence Threshold: 0.400 (Çok Konservatif)
ATR Low PCT: 0.020 (Çok Konservatif)
```

### 🎯 RSI Dynamic Bonus
- **RSI < 25 veya > 75:** Confidence %10 azalır
- **Fırsat Kaçırmama:** Uç değerlerde agresiflik

---

## 💰 Fee-Aware Trading System

### 🔧 Gerçek PnL Hesaplama
- **Entry Fee:** Otomatik hesaplama ve düşme
- **Exit Fee:** Satış sonrası otomatik düşme
- **Net PnL:** Gerçek kâr/zarar (fee'ler dahil)
- **Fee Rates:** Kraken API'den dinamik alım (0.26% taker, 0.16% maker)

### ⚖️ Orphaned Positions Auto-Cleanup
- **Dust Detection:** <0.00002 BTC için uyarı vermez
- **Auto Sell:** ≥0.00002 BTC otomatik satış
- **Database Sync:** positions_history tablosuna kayıt
- **Telegram Alert:** "Auto cleanup executed" bildirimi
- **Daily Cleanup:** Gün sonu otomatik temizlik

### 🧹 Dust Management
- **Smart Detection:** Toz vs gerçek kalıntı ayrımı
- **PnL Adjustment:** Sadece anlamlı kalıntılar için PnL düzeltmesi
- **Auto Convert:** Küçük miktarları CAD'ye çevirme
- **Fallback System:** Güvenli hata yönetimi

---

## ⚙️ Risk Yönetimi

### 💰 Position Sizing
- **Risk per Trade:** 15 CAD (20$'ın %75'i)
- **Max Daily Loss:** 40 CAD (2x Koruma)
- **Max Daily Trades:** 5 işlem/gün
- **Cooldown:** 5 dakika (işlemler arası)

### 🛡️ Stop Loss & Take Profit
- **Stop Loss:** 0.8x ATR (Dinamik)
- **Take Profit:** 1.5x ATR (Risk/Reward: 1:1.88)
- **Trailing Stop:** ATR-based dynamic trailing

### 📊 Single Position Rule
- **Tek Pozisyon:** Aynı anda sadece 1 pozisyon
- **Position Management:** Otomatik takip ve yönetim
- **Dust Protection:** Minimum lot size kontrolü

---

## 📱 Telegram Integration

### 🤖 Bot Komutları
- `/start` - Bot başlatma ve hoş geldin
- `/status` - Genel bot durumu
- `/positions` - Açık pozisyonlar
- `/ai_status` - AI parametreleri ve adaptive mode
- `/optimize` - Manuel AI optimizasyonu
- `/flat` - Acil pozisyon kapatma
- `/help` - Yardım menüsü

### 📊 AI Status Display
```
🧠 Adaptive Scalper Mode
Adaptive: ON
ATR Low PCT: 0.010
Confidence Threshold: 0.200
Mode: Low-Vol Scalper
```

### 🔔 Bildirimler
- **Trade Alerts:** Pozisyon açma/kapama + Net PnL
- **Auto Cleanup:** Orphaned positions satış bildirimi
- **PnL Corrections:** Gerçek bakiye düzeltmeleri
- **Error Notifications:** Hata durumları
- **Daily Summary:** Günlük özet + cleanup raporu
- **Extreme RSI:** Aşırı RSI değerleri
- **Fee Updates:** Dinamik fee rate güncellemeleri

---

## 🗄️ Veritabanı

### 📊 Trade Tracking
- **Trade History:** Tüm işlemler kayıtlı (entry/exit fees dahil)
- **Performance Metrics:** Win rate, profit factor, net PnL
- **Position Management:** Açık pozisyon takibi + orphaned detection
- **AI Learning Data:** Optimizasyon geçmişi + adaptive parameters
- **Cleanup Records:** Auto-cleanup işlemleri kayıtlı

### 🔄 Data Persistence
- **Position Recovery:** Bot restart sonrası pozisyon geri yükleme
- **Orphaned Sync:** Cüzdan-DB otomatik senkronizasyon
- **State Management:** Bot durumu korunması + fee rates
- **Error Handling:** Hata durumlarında veri korunması
- **Daily Cleanup:** Günlük otomatik temizlik kayıtları

---

## ⚡ Performance Features

### 🚀 Optimizasyonlar
- **ATR Normalization:** Her pariteye uyum + 10-candle average
- **Fee-Aware Calculations:** Gerçek net PnL hesaplama
- **Orphaned Detection:** Akıllı dust vs real balance ayrımı
- **Memory Management:** Efficient state handling + cleanup
- **Error Recovery:** Otomatik hata kurtarma + fallback systems
- **API Optimization:** Kraken fee rates dinamik alım

### 📈 Monitoring
- **Real-time Logs:** Detaylı işlem logları + cleanup logs
- **Performance Metrics:** Win rate, profit tracking, net PnL
- **Market Analysis:** Piyasa durumu analizi + adaptive parameters
- **Balance Sync:** Gerçek cüzdan-DB senkronizasyonu
- **Cleanup Tracking:** Orphaned positions takibi

---

## 🎯 Current Configuration

### 📊 Active Settings
- **Trading Symbol:** BTC/CAD (Tek parite odaklı)
- **Timeframe:** 5 dakika (Hızlı scalping)
- **Risk per Trade:** 15 CAD
- **Max Daily Loss:** 40 CAD
- **Max Daily Trades:** 5
- **Cooldown:** 5 dakika

### 🧠 Adaptive Parameters
- **Confidence Threshold:** 0.200 (Gevşetilmiş)
- **ATR Low PCT:** 0.01 (Agresif)
- **RSI Oversold:** 35
- **RSI Overbought:** 65
- **Volume Z-Score Min:** -1.0

---

## 🔧 Technical Specifications

### 💻 System Requirements
- **Node.js:** ES6 Modules
- **Database:** MySQL/MariaDB
- **Process Manager:** PM2
- **API:** Kraken REST API
- **Telegram:** Bot API

### 📦 Dependencies
- **Trading:** Kraken API integration
- **Database:** MySQL connection
- **Telegram:** Bot API
- **Technical Analysis:** Custom indicators
- **AI:** Machine learning algorithms

---

## 🎉 Key Benefits

### ✅ Advantages
- **Adaptive Strategy:** Piyasa koşullarına göre ayarlama
- **Fee-Aware Trading:** Gerçek net PnL hesaplama
- **Orphaned Cleanup:** Otomatik kalıntı temizliği
- **Risk Management:** Comprehensive risk controls + dust management
- **AI Learning:** Continuous improvement + adaptive parameters
- **Telegram Integration:** Real-time monitoring + cleanup alerts
- **Single Position:** Focused trading approach + balance sync
- **Low Capital:** Optimized for small accounts (20$)
- **Real PnL:** Bot PnL = Gerçek Kraken bakiyesi

### 🚀 Performance
- **Automated Trading:** 24/7 operation + auto cleanup
- **Fast Execution:** 5-minute scalping + 1s settlement delay
- **Error Recovery:** Robust error handling + fallback systems
- **Data Persistence:** Reliable state management + sync
- **Real-time Monitoring:** Telegram notifications + cleanup alerts
- **Balance Accuracy:** PnL ve gerçek bakiye eşleşmesi

---

## 📝 Version Info
- **Version:** 2.1 (Fee-Aware + Orphaned Cleanup)
- **Last Updated:** 2025-10-27
- **Features:** AI Learning, Adaptive Parameters, Fee-Aware Trading, Orphaned Positions Auto-Cleanup, Dust Management, Real PnL System
- **Status:** Production Ready ✅
