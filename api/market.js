const SYMBOL = 'GBPJPY=X';
const PAIR = 'GBP/JPY';
const PIP = 0.01;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=20');
  res.end(JSON.stringify(body));
}

async function fetchYahoo(interval, range = '5d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}?interval=${interval}&range=${range}&includePrePost=true&events=div%2Csplits`;

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 GBPJPY-Radar/1.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });

  if (!r.ok) throw new Error(`Market feed HTTP ${r.status}`);

  const data = await r.json();
  const result = data?.chart?.result?.[0];

  if (!result) throw new Error('Market feed returned no data');

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};

  const candles = ts.map((t, i) => ({
    t: Number(t),
    open: Number(q.open?.[i]),
    high: Number(q.high?.[i]),
    low: Number(q.low?.[i]),
    close: Number(q.close?.[i])
  })).filter(c => [c.t, c.open, c.high, c.low, c.close].every(Number.isFinite));

  return { candles };
}

function confirmedCandles(candles, seconds) {
  const now = Math.floor(Date.now() / 1000);
  const closed = candles.filter(c => c.t + seconds <= now);
  return closed.length ? closed : candles.slice(0, -1);
}

function getPivots(candles, len = 3) {
  const highs = [];
  const lows = [];

  for (let i = len; i < candles.length - len; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - len; j <= i + len; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }

    if (isHigh) highs.push({ price: candles[i].high });
    if (isLow) lows.push({ price: candles[i].low });
  }

  return { highs, lows };
}

function trendFromPivots(candles) {
  const { highs, lows } = getPivots(candles, 3);

  if (highs.length < 2 || lows.length < 2) {
    return { trend: 'NEUTRAL' };
  }

  const h1 = highs[highs.length - 2].price;
  const h2 = highs[highs.length - 1].price;
  const l1 = lows[lows.length - 2].price;
  const l2 = lows[lows.length - 1].price;

  if (h2 > h1 && l2 > l1) return { trend: 'BULLISH' };
  if (h2 < h1 && l2 < l1) return { trend: 'BEARISH' };

  return { trend: 'NEUTRAL' };
}

function nearestLevels(candles, price) {
  const { highs, lows } = getPivots(candles, 3);

  const supports = lows.map(x => x.price).filter(p => p <= price);
  const resistances = highs.map(x => x.price).filter(p => p >= price);

  const recent = candles.slice(-60);

  return {
    support: supports.length
      ? Math.max(...supports)
      : Math.min(...recent.map(c => c.low)),

    resistance: resistances.length
      ? Math.min(...resistances)
      : Math.max(...recent.map(c => c.high))
  };
}

function analyze(c5, c15) {
  const last = c5[c5.length - 1];
  const price = last.close;

  const trend = trendFromPivots(c15);
  const { support, resistance } = nearestLevels(c5, price);

  const tolerance = 0.0006;
  const buffer = 0.0003;

  const bullish = last.close > last.open;
  const bearish = last.close < last.open;

  const atSupport =
    last.low <= support * (1 + tolerance) &&
    last.close >= support;

  const atResistance =
    last.high >= resistance * (1 - tolerance) &&
    last.close <= resistance;

  let side = null;
  let sl = null;
  let tp = null;

  if (trend.trend === 'BULLISH' && atSupport && bullish) {
    side = 'BUY';
    sl = support * (1 - buffer);
    tp = price + (price - sl) * 2;
  }

  if (trend.trend === 'BEARISH' && atResistance && bearish) {
    side = 'SELL';
    sl = resistance * (1 + buffer);
    tp = price - (sl - price) * 2;
  }

  return {
    verdict: side || 'NO_TRADE',
    pair: PAIR,
    price: Number(price.toFixed(3)),
    entry: side ? Number(price.toFixed(3)) : null,
    sl: side ? Number(sl.toFixed(3)) : null,
    tp: side ? Number(tp.toFixed(3)) : null,
    rr: side ? 2 : null,
    support: Number(support.toFixed(3)),
    resistance: Number(resistance.toFixed(3)),
    trend: trend.trend,
    candleTime: new Date(last.t * 1000).toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    const [five, fifteen] = await Promise.all([
      fetchYahoo('5m', '5d'),
      fetchYahoo('15m', '10d')
    ]);

    const c5 = confirmedCandles(five.candles, 300);
    const c15 = confirmedCandles(fifteen.candles, 900);

    const analysis = analyze(c5, c15);

    json(res, 200, {
      ok: true,
      source: 'Yahoo Finance',
      generatedAt: new Date().toISOString(),
      ...analysis
    });

  } catch (err) {
    json(res, 502, {
      ok: false,
      error: err?.message || String(err)
    });
  }
};
