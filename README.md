# 🤖 Kraken AI Trading Bot - Güncel Özellikler

## 📊 Genel Bakış
- **Platform:** Kraken Exchange (CAD Spot Markets)
- **Strateji:** AI-Powered Adaptive Scalper + Fee-Aware Trading
- **Risk Yönetimi:** Dinamik Stop Loss & Take Profit + Orphaned Positions Cleanup
- **Dust Management:** 3-Katmanlı Otomatik Temizlik Sistemi
- **Bildirimler:** Telegram Bot Integration + Real-time Alerts
- **Veritabanı:** MySQL/MariaDB + Auto-sync
- **PnL System:** Gerçek Kraken Bakiyesi Uyumlu + Dust-Aware Hesaplama

---

## 🧹 Dust Management System

### 🎯 3-Katmanlı Otomatik Temizlik Sistemi

#### 1️⃣ **Fee-Aware Satış**
- Satış miktarı komisyon düşülerek hesaplanır: `sellAmount = qty * (1 - feeRate)`
- %0.26 Kraken taker fee otomatik düşülür
- Kırıntı oluşumu minimize edilir

#### 2️⃣ **Immediate Post-Close Cleanup**
- Her pozisyon kapanışından hemen sonra çalışır
- 0.00001 BTC altındaki kırıntıları anında temizler
- 12 saat beklemeden otomatik satış yapar
- Telegram bildirimi ile raporlanır

#### 3️⃣ **Scheduled Dust Cleanup**
- 12 saatte bir otomatik çalışır
- Tüm base currency'leri kontrol eder
- 2 CAD altındaki dust'ları CAD'e çevirir
- **4-Katmanlı Convert Sistemi:**
  1. Kraken Convert API (`privatePostConvert`)
  2. Trade Convert API (`privatePostTrade` with `convert: true`)
  3. ConvertTrade API (`privatePostConvertTrade`)
  4. Regular Market Sell (fallback)
- Detaylı rapor ve istatistik gönderir

#### 4️⃣ **Orphaned Positions Cleanup**
- Gerçek pozisyonu olmayan coinleri otomatik satar
- Dust threshold override ile minimum altındaki kırıntıları da temizler
- `DUST_FORCE_CLEANUP` ile zorla satış yapar

### 📊 Dust Cleanup Thresholds
- **Immediate Cleanup:** < 0.0001 BTC (increased from 0.00001)
- **Scheduled Cleanup:** < 2.00 CAD value (increased from 1.00)
- **Force Cleanup:** > 0.000001 BTC (minimum altı ama anlamlı)

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
- `/migration` - Balance migration istatistikleri
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
- **Balance Migration:** Eski trade kayıtlarında eksik balance_before değerlerini geriye dönük doldurma

---

## 🔄 Balance Migration System

### 📊 Historical Data Recovery
- **Automatic Detection:** Bot başlangıcında eksik balance_before değerlerini tespit eder
- **Backward Calculation:** Son bilinen balance değerinden geriye doğru hesaplama
- **Smart Algorithm:** net_balance_change veya pnl_net kullanarak balance_before hesaplar
- **Data Integrity:** Mevcut verileri korur, sadece eksik olanları doldurur

### 🎯 Migration Process
```javascript
// Migration Algorithm
1. Son bilinen balance_after değerini bul
2. Trade'leri ters kronolojik sırada işle (yeni → eski)
3. Her trade için:
   - balance_before = currentBalance - net_balance_change
   - Negatif balance'ları 0'a çek
   - Database'i güncelle
4. İstatistikleri raporla
```

### 📱 Migration Commands
- **`/migration`** - Migration istatistiklerini gösterir
- **Auto Migration** - Bot başlangıcında otomatik çalışır
- **Telegram Notifications** - Migration tamamlandığında bildirim

### 📊 Migration Statistics Example
```
🔄 Balance Migration Statistics

📊 Data Coverage:
Total Trades: 25
With Balance Before: 20
Missing Balance Before: 5
With Balance After: 25
Missing Balance After: 0

⚠️ Migration Needed

Run bot restart to trigger automatic migration.
```

### ✅ Migration Benefits
- **Data Consistency:** Tüm geçmiş trade'lerde tutarlı balance verisi
- **PnL Accuracy:** Gerçek Kraken bakiyesi ile bot PnL'si eşleşmesi
- **Historical Analysis:** Geçmiş performans analizi için tam veri
- **Error Prevention:** "Bot thinks it's making profit but actually losing" sorununu çözer

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

## 🎯 Explain Mode (Clean Feed)

### 📱 Smart Notifications
- **No Spam:** Market summary mesajları tamamen kaldırıldı
- **Action-Based:** Sadece alım/satım/zarar durumlarında mesaj
- **Detailed Reasoning:** Her işlem için gerekçeli açıklama
- **AI Learning:** Zarar sonrası otomatik AI ağırlık ayarı

### 🔔 Message Types
```
🟢 BUY EXECUTED (BTC/CAD)
Price: 95,234.50 CAD
Confidence: 78.5%

📊 Reason:
RSI (28.3) → Oversold
EMA20 (95,100) > EMA50 (94,800) → Bullish trend
ATR = 0.85% → Normal volatility

🤖 Decision:
AI, düşük RSI ve yükselen trend kombinasyonu nedeniyle alım yaptı.
```

```
🔴 SELL EXECUTED (BTC/CAD)
Entry: 95,234.50 → Exit: 96,150.25
PnL: +91.75 CAD (+0.96%)

📊 Reason:
RSI (68.2) → Normal
Trend momentum zayıfladı (EMA20 < EMA50)

🤖 Decision:
Kâr alımı yapıldı — momentum zayıfladığı için pozisyon kapatıldı.
```

```
⚠️ TRADE CLOSED — LOSS

PnL: -15.30 CAD

📊 Reason:
EMA kırıldı, RSI toparlanamadı (45.2).  
Stop-loss tetiklendi, fiyat momentum kaybetti.

🤖 Adjustment:
AI, sonraki optimizasyonda RSI ağırlığını %1 azaltacak.
```

---

## 🧠 Self-Learning Mode

### 🔄 Automatic Weight Optimization
- **Trade Analysis:** Her işlem sonrası otomatik analiz
- **Weight Adjustment:** Kazanç/kayıp durumuna göre ağırlık ayarı
- **Learning Log:** Son 50 işlem kayıtlı (ai-learning-log.json)
- **Runtime Optimization:** Strateji parametreleri otomatik güncelleme

### 📊 Learning Algorithm
```
Kazanç (PnL > 0):
- RSI +1%, EMA +1%
- ATR -0.5%, VOL -0.5%

Kayıp (PnL < 0):
- RSI -1%, EMA -1%
- ATR +0.5%, VOL +0.5%
```

### 🎯 Enhanced Explain Messages
```
✅ TRADE CLOSED — PROFIT

PnL: +15.30 CAD

📊 Reason: Hedef fiyat seviyesine ulaşıldı, kâr alımı yapıldı

🤖 Adjustment: RSI +1%, EMA +1%, ATR -0.5%, VOL -0.5%

🧠 AI Weights Updated →
RSI 0.41, EMA 0.31, ATR 0.14, VOL 0.14
```

### ⚠️ Low-Risk Mode
- **Activation:** 10 işlemde 5+ kayıp
- **Actions:** TP=2.0x, SL sıkılaştırma
- **Notification:** Telegram bildirimi
- **Auto-Recovery:** Performans iyileşince normale dönüş

### 💾 Backup System
- **Auto Backup:** ai-memory/ klasörüne yedekleme
- **Files:** ai-weights.json, runtime-config.json, ai-learning-log.json
- **Timestamp:** YYYY-MM-DD-HHMM formatında

### 🔧 Runtime Config Auto-Optimization
- **Win Rate < 50%:** RSI aralıkları gevşetilir
- **Profit Factor < 1.2:** TP multiplier %10 artırılır
- **Drawdown > Risk*8:** SL multiplier %10 sıkılaştırılır
- **Auto-Save:** JSON ve veritabanına kayıt

---

## 🎉 Key Benefits

### ✅ Advantages
- **Adaptive Strategy:** Piyasa koşullarına göre ayarlama
- **Fee-Aware Trading:** Gerçek net PnL hesaplama
- **Orphaned Cleanup:** Otomatik kalıntı temizliği
- **Explain Mode:** Gerekçeli açıklama mesajları
- **Self-Learning:** Her işlem sonrası otomatik öğrenme
- **Risk Management:** Comprehensive risk controls + dust management
- **AI Learning:** Continuous improvement + adaptive parameters + loss learning
- **Telegram Integration:** Real-time monitoring + cleanup alerts + clean feed
- **Single Position:** Focused trading approach + balance sync
- **Low Capital:** Optimized for small accounts (20$)
- **Real PnL:** Bot PnL = Gerçek Kraken bakiyesi
- **No Spam:** Temiz Telegram feed, sadece önemli mesajlar
- **Auto-Backup:** AI memory sistemi ile güvenli yedekleme
- **Balance Migration:** Eski trade verilerinin otomatik düzeltilmesi

### 🚀 Performance
- **Automated Trading:** 24/7 operation + auto cleanup
- **Fast Execution:** 5-minute scalping + 1s settlement delay
- **Error Recovery:** Robust error handling + fallback systems
- **Data Persistence:** Reliable state management + sync
- **Real-time Monitoring:** Telegram notifications + cleanup alerts + explain mode
- **Balance Accuracy:** PnL ve gerçek bakiye eşleşmesi
- **Clean Feed:** Spam-free Telegram notifications
- **AI Learning:** Loss-based automatic weight adjustment
- **Self-Learning:** Her işlem sonrası otomatik optimizasyon
- **Memory System:** AI learning log + backup sistemi

---

## 📝 Version Info
- **Version:** 2.5 (Balance Migration System)
- **Last Updated:** 2025-01-15
- **Features:** AI Learning, Adaptive Parameters, Fee-Aware Trading, Orphaned Positions Auto-Cleanup, Dust Management, Real PnL System, Explain Mode, Self-Learning Mode, Balance Migration System
- **Status:** Production Ready ✅
