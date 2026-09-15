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
  if (!result) throw new Error(data?.chart?.error?.description || 'Market feed returned no data');

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const candles = ts.map((t, i) => ({
    t: Number(t),
    open: Number(q.open?.[i]),
    high: Number(q.high?.[i]),
    low: Number(q.low?.[i]),
    close: Number(q.close?.[i])
  })).filter(c => [c.t,c.open,c.high,c.low,c.close].every(Number.isFinite));

  return {
    meta: result.meta || {},
    candles
  };
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
    if (isHigh) highs.push({ index: i, price: candles[i].high, t: candles[i].t });
    if (isLow) lows.push({ index: i, price: candles[i].low, t: candles[i].t });
  }
  return { highs, lows };
}

function trendFromPivots(candles) {
  const { highs, lows } = getPivots(candles, 3);
  if (highs.length < 2 || lows.length < 2) {
    return { trend: 'NEUTRAL', highStructure: '—', lowStructure: '—' };
  }
  const h1 = highs[highs.length - 2].price;
  const h2 = highs[highs.length - 1].price;
  const l1 = lows[lows.length - 2].price;
  const l2 = lows[lows.length - 1].price;
  const hh = h2 > h1;
  const hl = l2 > l1;
  const lh = h2 < h1;
  const ll = l2 < l1;
  return {
    trend: hh && hl ? 'BULLISH' : lh && ll ? 'BEARISH' : 'NEUTRAL',
    highStructure: hh ? 'HH' : lh ? 'LH' : 'EQH',
    lowStructure: hl ? 'HL' : ll ? 'LL' : 'EQL',
    lastHigh: h2,
    prevHigh: h1,
    lastLow: l2,
    prevLow: l1
  };
}

function nearestLevels(candles, price) {
  const { highs, lows } = getPivots(candles, 3);
  const supportCandidates = lows.map(x => x.price).filter(p => p <= price);
  const resistanceCandidates = highs.map(x => x.price).filter(p => p >= price);

  const recent = candles.slice(-60);
  const fallbackSupport = Math.min(...recent.map(c => c.low));
  const fallbackResistance = Math.max(...recent.map(c => c.high));

  const support = supportCandidates.length ? Math.max(...supportCandidates) : fallbackSupport;
  const resistance = resistanceCandidates.length ? Math.min(...resistanceCandidates) : fallbackResistance;
  return { support, resistance };
}

function analyze(c5, c15) {
  const last = c5[c5.length - 1];
  if (!last) throw new Error('Not enough 5 minute candles');
  const price = last.close;
  const trend = trendFromPivots(c15);
  const { support, resistance } = nearestLevels(c5, price);

  const tolerance = 0.0006; // 0.06%
  const buffer = 0.0003;    // 0.03%
  const body = Math.max(Math.abs(last.close - last.open), PIP / 10);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);

  const bullishCandle = last.close > last.open;
  const bearishCandle = last.close < last.open;
  const atSupport = last.low <= support * (1 + tolerance) && last.close >= support;
  const atResistance = last.high >= resistance * (1 - tolerance) && last.close <= resistance;
  const bullishRejection = bullishCandle && lowerWick >= body * 0.30;
  const bearishRejection = bearishCandle && upperWick >= body * 0.30;

  let side = null;
  let entry = price;
  let sl = null;
  let tp = null;
  let riskPips = null;
  let checks = [];

  if (trend.trend === 'BULLISH') {
    sl = support * (1 - buffer);
    riskPips = (entry - sl) / PIP;
    const riskOkay = riskPips >= 6 && riskPips <= 40;
    checks = [
      { key: 'trend', label: 'Tendencia 15M alcista (HH + HL)', pass: true },
      { key: 'zone', label: 'Precio reaccionando en soporte 5M', pass: atSupport },
      { key: 'confirm', label: 'Vela 5M con rechazo alcista', pass: bullishRejection },
      { key: 'risk', label: 'Stop técnico entre 6 y 40 pips', pass: riskOkay }
    ];
    if (checks.every(c => c.pass)) {
      side = 'BUY';
      tp = entry + (entry - sl) * 2;
    }
  } else if (trend.trend === 'BEARISH') {
    sl = resistance * (1 + buffer);
    riskPips = (sl - entry) / PIP;
    const riskOkay = riskPips >= 6 && riskPips <= 40;
    checks = [
      { key: 'trend', label: 'Tendencia 15M bajista (LH + LL)', pass: true },
      { key: 'zone', label: 'Precio reaccionando en resistencia 5M', pass: atResistance },
      { key: 'confirm', label: 'Vela 5M con rechazo bajista', pass: bearishRejection },
      { key: 'risk', label: 'Stop técnico entre 6 y 40 pips', pass: riskOkay }
    ];
    if (checks.every(c => c.pass)) {
      side = 'SELL';
      tp = entry - (sl - entry) * 2;
    }
  } else {
    checks = [
      { key: 'trend', label: 'Tendencia 15M clara (HH+HL o LH+LL)', pass: false },
      { key: 'zone', label: 'Precio en soporte/resistencia 5M', pass: atSupport || atResistance },
      { key: 'confirm', label: 'Confirmación 5M', pass: bullishRejection || bearishRejection },
      { key: 'risk', label: 'Stop técnico válido', pass: false }
    ];
  }

  const passed = checks.filter(c => c.pass).length;
  return {
    verdict: side || 'NO_TRADE',
    side,
    pair: PAIR,
    timeframeEntry: '5m',
    timeframeTrend: '15m',
    entry: Number(entry.toFixed(3)),
    sl: side ? Number(sl.toFixed(3)) : null,
    tp: side ? Number(tp.toFixed(3)) : null,
    rr: side ? 2 : null,
    riskPips: side ? Number(riskPips.toFixed(1)) : null,
    price: Number(price.toFixed(3)),
    support: Number(support.toFixed(3)),
    resistance: Number(resistance.toFixed(3)),
    trend,
    checklist: checks,
    passedChecks: passed,
    totalChecks: checks.length,
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
    if (c5.length < 50 || c15.length < 40) throw new Error('Not enough market history');
    const analysis = analyze(c5, c15);
    json(res, 200, {
      ok: true,
      source: 'Yahoo Finance chart feed (experimental)',
      note: 'Prototype feed. Confirm prices with your broker before any execution.',
      generatedAt: new Date().toISOString(),
      ...analysis
    });
  } catch (err) {
    json(res, 502, {
      ok: false,
      error: err?.message || String(err),
      generatedAt: new Date().toISOString()
    });
  }
};
