/**
 * Kraken-specific OHLCV data sanitizer
 * Handles common Kraken data quality issues
 */

export function sanitizeOHLCV(ohlcv = []) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return [];

  // Log öncesi
  console.log(`[DEBUG] OHLCV before filtering: ${ohlcv.length} candles`);

  const cleaned = ohlcv
    .filter(c => Array.isArray(c) && c.length >= 6)
    .map(c => {
      let [t, o, h, l, cl, v] = c;
      
      // Eksik değerleri önce düzeltelim:
      o = isFinite(o) && o > 0 ? o : cl || h || l || 0;
      h = isFinite(h) && h > 0 ? h : o;
      l = isFinite(l) && l > 0 ? l : o;
      cl = isFinite(cl) && cl > 0 ? cl : o;
      v = isFinite(v) && v >= 0 ? v : 0;
      
      return [t, o, h, l, cl, v];
    })
    .filter(c => c[1] > 0 && c[4] > 0); // open ve close > 0 olmalı

  const invalidCount = ohlcv.length - cleaned.length;
  console.log(`[DEBUG] OHLCV after filtering: ${cleaned.length} valid candles`);
  console.log(`[INFO] Filter removed ${invalidCount} invalid candles (${cleaned.length}/${ohlcv.length} valid)`);

  return cleaned;
}
