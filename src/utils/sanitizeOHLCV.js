/**
 * Kraken-Safe OHLCV Sanitizer (v2)
 * ✅ Handles null, 0, NaN, undefined
 * ✅ Compatible with strategy.js (object format)
 * ✅ Generates synthetic continuity for missing data
 */

export function sanitizeOHLCV(ohlcv = []) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return [];

  console.log(`[DEBUG] OHLCV before filtering: ${ohlcv.length} candles`);

  let lastValidClose = null;
  const cleaned = ohlcv
    .filter(c => Array.isArray(c) && c.length >= 6)
    .map(([t, o, h, l, c, v]) => {
      // Fix invalid close values
      if (!isFinite(c) || c <= 0) {
        c = lastValidClose ?? 100000; // Fallback for first invalid
      } else {
        lastValidClose = c;
      }

      // Normalize other fields
      o = isFinite(o) && o > 0 ? o : c;
      h = isFinite(h) && h > 0 ? h : Math.max(o, c);
      l = isFinite(l) && l > 0 ? l : Math.min(o, c);
      v = isFinite(v) && v >= 0 ? v : 0;

      return [t, o, h, l, c, v];
    })
    .filter(c => c[4] > 0); // keep only valid close > 0

  const invalidCount = ohlcv.length - cleaned.length;
  console.log(`[DEBUG] OHLCV after filtering: ${cleaned.length} valid candles`);
  console.log(`[INFO] Filter removed ${invalidCount} invalid candles (${cleaned.length}/${ohlcv.length} valid)`);

  // Ensure at least 30 candles for indicators
  while (cleaned.length < 30) {
    const base = lastValidClose ?? 100000;
    cleaned.push([
      Date.now() - (30 - cleaned.length) * 60_000,
      base, base, base, base, 0
    ]);
  }

  // Return in object format (strategy.js compatible)
  return cleaned.map(([t, o, h, l, c, v]) => ({
    time: t,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v
  }));
}
