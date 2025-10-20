# 🚀 Kraken AI Trader - Kurulum ve Çalıştırma Rehberi

## ✅ Yapılan İyileştirmeler

### 1. Exchange Katmanı (exchange.js)
- ✅ CAD market otomatik keşfi ve filtreleme
- ✅ XBT/BTC sembol normalizasyonu (Kraken uyumu)
- ✅ Market buy `cost` desteği (CAD tutarı ile alış)
- ✅ Exponential backoff retry logic (100→250→500ms)
- ✅ Fee tracking ve extraction
- ✅ Tek pozisyon kontrolü (`hasOpenPosition`)
- ✅ Base balance takibi

### 2. Strateji Katmanı (strategy.js)
- ✅ **Kapalı mum garantisi**: Sinyal `close[-2]`, yürütme `close[-1]`
- ✅ Time-based exit: 45 mum içinde TP/SL değilse kapat
- ✅ Trailing stop: 1R kazançta break-even+buffer'a çek
- ✅ Risk/reward hesaplama
- ✅ Candles elapsed tracking

### 3. AI Öğrenme (ai.js)
- ✅ Runtime-config.json ile parametre persistence
- ✅ Gelişmiş optimizasyon kuralları:
  - WinRate < 52% → RSI genişlet
  - PF < 1.2 → TP artır
  - MaxDD > 8×risk → ATR filtre sıkılaştır
- ✅ TP/SL multiplier dinamik ayarlama
- ✅ Optimization history tracking

### 4. Veritabanı (db.js, schema.sql)
- ✅ Fee tracking: `entry_fee`, `exit_fee`, `total_fees`
- ✅ Net PnL: `pnl_net` (fee'den sonra)
- ✅ Transaction support (rollback)
- ✅ Null guards tüm parametrelerde
- ✅ `candles_held` tracking

### 5. Telegram (telegram.js)
- ✅ User authorization (whitelist)
- ✅ `/optimize` komutu
- ✅ `/flat` emergency close
- ✅ Gelişmiş bildirimler (fee, net PnL)
- ✅ Unauthorized user engelleme

### 6. Ana Döngü (index.js) - TAM YENİ
- ✅ **Tek pozisyon prensibi**: Aynı anda sadece 1 crypto
- ✅ **Gün sıfırlama**: UTC 00:00'da limit reset
- ✅ **Dry-run modu**: `DRY_RUN=true` ile test
- ✅ **Trailing stop**: 1R'de break-even
- ✅ **Emergency flat**: Global flag ile anında kapama
- ✅ Best signal seçimi: Tüm sembolleri tarayıp en yüksek confidence
- ✅ Daily limits kontrolü
- ✅ Cooldown management
- ✅ Self-healing error recovery

## 📋 Kurulum Adımları

### 1. Bağımlılıkları Yükle
```bash
npm install
```

### 2. Veritabanını Oluştur
```bash
# MySQL'i başlat (XAMPP kullanıyorsan)
# Sonra:
mysql -u root -p < schema.sql
```

### 3. .env Dosyasını Yapılandır
`.env` dosyası oluştur (`.env.example` template'inden):

```env
# Kraken API (READ + TRADE only, NO WITHDRAW!)
KRAKEN_API_KEY=your_api_key
KRAKEN_API_SECRET=your_api_secret

# Trading
TRADING_SYMBOLS=BTC/CAD,ETH/CAD,SOL/CAD
RISK_CAD=2
MAX_DAILY_LOSS_CAD=5
MAX_DAILY_TRADES=10
COOLDOWN_MINUTES=5

# Strategy (runtime-config.json'dan override olur)
RSI_OVERSOLD=38
RSI_OVERBOUGHT=62
ATR_LOW_PCT=0.4
ATR_HIGH_PCT=2.0

# AI
AI_OPT_INTERVAL_MIN=360
AI_LEARNING_RATE=0.02

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=kraken_trader

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Bot Settings
ENABLE_TRADING=true
ENABLE_TELEGRAM=true
DRY_RUN=false
```

### 4. İlk Test (Dry-Run)
```bash
# Önce DRY_RUN=true yap
DRY_RUN=true npm start
```
Bu modda:
- Gerçek emir gönderilmez
- Sinyaller loglanır
- Tüm akış test edilir

### 5. Canlı Başlat (PM2)
```bash
# DRY_RUN=false yap
# Sonra:
npm run pm2:start

# Logları izle
npm run pm2:logs

# Durdur
npm run pm2:stop
```

## 🎯 Sistem Akışı

### Her 1 Dakika:
1. **Gün kontrolü**: UTC 00:00'da reset
2. **Pozisyon var mı?**
   - **EVET** → SL/TP/Time-exit kontrol + Trailing
   - **HAYIR** → Tüm sembolleri tara, en iyi sinyal seç, al
3. **Emergency flat** flag kontrol
4. **Günlük limitler** kontrol
5. **6 saatte bir** → AI optimize

### Tek Pozisyon Kuralı:
```
IF crypto_balance > 1 CAD THEN
  → Çıkış kontrolü yap
  → Yeni alım yapma
ELSE
  → Tüm CAD sembolleri tara
  → En yüksek confidence'ı seç
  → Alış yap
END
```

### Kapalı Mum Garantisi:
```
Analiz: close[-2] (tamamlanmış mum)
Yürütme: close[-1] (güncel fiyat)
```

### Trailing Stop:
```
IF profit >= 1R THEN
  new_SL = entry + (0.1 × R)
END
```

## 📱 Telegram Komutları

| Komut | Açıklama |
|-------|----------|
| `/status` | Pozisyon, bakiye, PnL |
| `/daily` | Günlük rapor |
| `/ai_status` | AI ağırlıkları ve parametreler |
| `/optimize` | Manuel optimizasyon tetikle |
| `/flat` | ACİL pozisyon kapatma |
| `/help` | Yardım menüsü |

## 🔧 Runtime Config

`runtime-config.json` otomatik oluşur ve AI tarafından güncellenir:

```json
{
  "rsi_oversold": 38,
  "rsi_overbought": 62,
  "atr_low_pct": 0.4,
  "atr_high_pct": 2.0,
  "tp_multiplier": 2.4,
  "sl_multiplier": 1.2,
  "last_optimized": "2025-10-20T...",
  "optimization_history": [...]
}
```

Bu değerler `.env`'deki değerleri override eder.

## 🧪 Test Senaryoları

### 1. Dry-Run Test
```bash
DRY_RUN=true TRADING_SYMBOLS=ETH/CAD npm start
```
Sonuç: Logda sinyal + hesaplamalar görünür, emir gitmez.

### 2. Tek Sembol Test
```bash
TRADING_SYMBOLS=ETH/CAD RISK_CAD=2 MAX_DAILY_TRADES=3 npm start
```

### 3. Düşük Risk Test
```bash
RISK_CAD=1 MAX_DAILY_LOSS_CAD=2 npm start
```

## 🛡️ Güvenlik Kontrol Listesi

- [ ] Kraken API sadece **Query + Trade** yetkili (Withdraw KAPALI)
- [ ] `.env` dosyası `.gitignore`'da
- [ ] `TELEGRAM_ALLOWED_USERS` ayarlı
- [ ] İlk gün `RISK_CAD=1-2` ile başla
- [ ] `MAX_DAILY_LOSS_CAD` makul seviyede (5-10 CAD)
- [ ] İlk 24 saat manuel izle

## 📊 Performans Metrikleri

Bot veritabanında şunları takip eder:

### trades tablosu:
- Entry/exit fee
- Net PnL (fee sonrası)
- Candles held
- Exit reason (SL/TP/TIME_EXIT)
- AI confidence

### daily_summary:
- Win rate
- Profit factor
- Max drawdown
- Avg win/loss

## 🐛 Sorun Giderme

### "Insufficient data for analysis"
→ Bot 220 mum bekliyor (EMA200 için), ~3-4 saat sonra başlar.

### "No valid trading symbols"
→ Sembol ismi yanlış veya Kraken'de yok. Log'da hangi sembollerin bulunduğunu gör.

### Telegram çalışmıyor
→ `TELEGRAM_ALLOWED_USERS` doğru mu? Chat ID'niz listeye ekli mi?

### MySQL connection error
→ XAMPP MySQL servisini başlattınız mı?

## 📈 İlk Çalıştırma Checklist

1. ✅ MySQL servis çalışıyor
2. ✅ `schema.sql` import edildi
3. ✅ `.env` dosyası hazır
4. ✅ Kraken API key test edildi
5. ✅ Telegram bot token doğru
6. ✅ `DRY_RUN=true` ile test yapıldı
7. ✅ `RISK_CAD` düşük değerle başlandı
8. ✅ PM2 kurulu

## 🎓 AI Öğrenme Döngüsü

**Her Trade Sonrası:**
```
reward = pnl > 0 ? +1 : -1
weights += learning_rate × reward
weights = clamp(weights, 0.3, 1.2)
weights = normalize(weights)  // toplamı 1.0
```

**6 Saatte Bir:**
```
IF win_rate < 52% THEN rsi_oversold -= 1
IF profit_factor < 1.2 THEN tp_multiplier × 1.1
IF max_dd > 8×risk THEN atr_low_pct += 0.1
```

## 🚀 Production Checklist

- [ ] En az 48 saat dry-run testi yapıldı
- [ ] Gerçek parayla 1-2 gün minimum riskle test edildi
- [ ] Telegram bildirimleri düzgün çalışıyor
- [ ] PM2 otomatik başlatma ayarlandı
- [ ] Günlük log kontrolü planlandı
- [ ] Yedek CAD bakiyesi mevcut

---

**Uyarı:** Bu bot eğitim amaçlıdır. Kripto trading risklidir. Sadece kaybedebileceğiniz parayla trade yapın.

