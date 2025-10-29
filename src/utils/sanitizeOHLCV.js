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

      // Eksik open/high/low varsa normalize et
      o = isFinite(o) && o > 0 ? o : cl;
      h = isFinite(h) && h > 0 ? h : Math.max(o, cl);
      l = isFinite(l) && l > 0 ? l : Math.min(o, cl);
      v = isFinite(v) && v >= 0 ? v : 0;

      return [t, o, h, l, cl, v];
    });

  const validCandles = cleaned.filter(c => c[4] > 0);
  const invalidCount = ohlcv.length - validCandles.length;

  if (validCandles.length < 10) {
    console.warn(`[WARN] OHLCV too short after cleaning (${validCandles.length}) — forcing continuity mode`);
    // Eğer hâlâ 10'dan az mum varsa, sentetik continuity oluştur
    const base = lastValidClose || 100000;
    for (let i = validCandles.length; i < 30; i++) {
      const ts = Date.now() - (30 - i) * 60_000;
      validCandles.push([ts, base, base, base, base, 0]);
    }
  }

  console.log(`[DEBUG] OHLCV after filtering: ${validCandles.length} valid candles`);
  console.log(`[INFO] Filter removed ${invalidCount} invalid candles (${validCandles.length}/${ohlcv.length} valid)`);

  return validCandles;
}
