/**
 * Kraken-specific OHLCV data sanitizer
 * Handles common Kraken data quality issues with ultra-flexible approach
 */

export function sanitizeOHLCV(ohlcv = []) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return [];

  console.log(`[DEBUG] OHLCV before filtering: ${ohlcv.length} candles`);

  let lastValidClose = 100000; // fallback başlangıç fiyatı (CAD bazlı default)
  let validCount = 0;

  const cleaned = ohlcv
    .filter(c => Array.isArray(c) && c.length >= 6)
    .map(c => {
      let [t, o, h, l, cl, v] = c.map(v => (isFinite(v) ? v : null));

      // Eğer close tamamen yoksa veya 0 ise, fallback
      if (!cl || cl <= 0) {
        cl = lastValidClose; // bir önceki geçerli fiyat
      }

      // Diğer değerleri normalize et
      o = isFinite(o) && o > 0 ? o : cl;
      h = isFinite(h) && h > 0 ? h : Math.max(o, cl);
      l = isFinite(l) && l > 0 ? l : Math.min(o, cl);
      v = isFinite(v) && v >= 0 ? v : 0;

      // Eğer tüm değerler hâlâ 0 veya NaN ise, fallback uygula
      if (o <= 0 && h <= 0 && l <= 0 && cl <= 0) {
        o = h = l = cl = lastValidClose;
      }

      // Geçerli kapanış varsa güncelle
      if (cl > 0) {
        lastValidClose = cl;
        validCount++;
      }

      return [t, o, h, l, cl, v];
    })
    // sadece tümü sıfır olmayan satırları koru
    .filter(c => c[4] > 0);

  // Ekstra guard: çok kısa veri varsa skip
  if (cleaned.length < 10) {
    console.warn(`[WARN] OHLCV too short after cleaning (${cleaned.length}) — skipping symbol`);
    return [];
  }

  const invalidCount = ohlcv.length - cleaned.length;
  console.log(`[DEBUG] OHLCV after filtering: ${cleaned.length} valid candles`);
  console.log(`[INFO] Filter removed ${invalidCount} invalid candles (${cleaned.length}/${ohlcv.length} valid)`);

  return cleaned;
}
