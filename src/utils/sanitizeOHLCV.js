/**
 * Kraken-specific OHLCV data sanitizer
 * Nihai, tam dayanıklı versiyon (Kraken Edition)
 * Handles all possible Kraken data quality issues
 */

export function sanitizeOHLCV(ohlcv = []) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return [];

  console.log(`[DEBUG] OHLCV before filtering: ${ohlcv.length} candles`);

  // Kraken bazen ilk mumlarda tüm değerleri null döndürür.
  // Bu durumda "sentetik başlangıç fiyatı" oluşturuyoruz.
  let lastValidClose = 100000;
  let firstValidFound = false;

  const cleaned = ohlcv
    .filter(c => Array.isArray(c) && c.length >= 6)
    .map((c, idx) => {
      let [t, o, h, l, cl, v] = c.map(v => (isFinite(v) ? v : null));

      // Eğer close tamamen yoksa, fallback kullan
      if (!cl || cl <= 0) {
        if (!firstValidFound) {
          // İlk valid mumdan önceki null değerler için sabit fallback uygula
          cl = lastValidClose;
        } else {
          // Son geçerli fiyatı koru
          cl = lastValidClose;
        }
      } else {
        lastValidClose = cl;
        firstValidFound = true;
      }

      // Eksik open/high/low varsa normalize et (performans iyileştirmesi)
      o = isFinite(o) && o > 0 ? o : cl;
      h = isFinite(h) && h > 0 ? h : (o > cl ? o : cl);
      l = isFinite(l) && l > 0 ? l : (o < cl ? o : cl);
      v = isFinite(v) && v >= 0 ? v : 0;

      return [t, o, h, l, cl, v];
    });

  const validCandles = cleaned.filter(c => c[4] > 0);
  const invalidCount = ohlcv.length - validCandles.length;

  // Continuity mode artık calculateIndicators içinde yapılıyor

  // NaN ve Infinity yakalayıcısı
  const finalCandles = validCandles.filter(c => c.every(v => isFinite(v)));

  console.log(`[DEBUG] OHLCV after filtering: ${finalCandles.length} valid candles`);
  console.log(`[INFO] Filter removed ${invalidCount} invalid candles (${finalCandles.length}/${ohlcv.length} valid)`);

  return finalCandles;
}
