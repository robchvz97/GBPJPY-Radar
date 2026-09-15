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
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}` +
    `?interval=${interval}&range=${range}&includePrePost=true&events=div%2Csplits`;

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
  })).filter(c =>
    [c.t, c.open, c.high, c.low, c.close].every(Number.isFinite)
  );

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

    if (isHigh) {
      highs.push({
        price: candles[i].high,
        time: candles[i].t
      });
    }

    if (isLow) {
      lows.push({
        price: candles[i].low,
        time: candles[i].t
      });
    }
  }

  return { highs, lows };
}

function trendFromPivots(candles) {
  const { highs, lows } = getPivots(candles, 3);

  if (highs.length < 2 || lows.length < 2) {
    return {
      trend: 'NEUTRAL',
      highStructure: 'N/A',
      lowStructure: 'N/A'
    };
  }

  const prevHigh = highs[highs.length - 2].price;
  const lastHigh = highs[highs.length - 1].price;

  const prevLow = lows[lows.length - 2].price;
  const lastLow = lows[lows.length - 1].price;

  const highStructure =
    lastHigh > prevHigh ? 'HH' :
    lastHigh < prevHigh ? 'LH' : 'EQ';

  const lowStructure =
    lastLow > prevLow ? 'HL' :
    lastLow < prevLow ? 'LL' : 'EQ';

  let trend = 'NEUTRAL';

  if (highStructure === 'HH' && lowStructure === 'HL') {
    trend = 'BULLISH';
  }

  if (highStructure === 'LH' && lowStructure === 'LL') {
    trend = 'BEARISH';
  }

  return {
    trend,
    highStructure,
    lowStructure,
    lastHigh,
    prevHigh,
    lastLow,
    prevLow
  };
}

function nearestLevels(candles, price) {
  const { highs, lows } = getPivots(candles, 3);

  const supports = lows
    .map(x => x.price)
    .filter(p => p <= price);

  const resistances = highs
    .map(x => x.price)
    .filter(p => p >= price);

  const recent = candles.slice(-60);

  const support = supports.length
    ? Math.max(...supports)
    : Math.min(...recent.map(c => c.low));

  const resistance = resistances.length
    ? Math.min(...resistances)
    : Math.max(...recent.map(c => c.high));

  return { support, resistance };
}

function analyze(c5, c15) {
  if (!c5.length || !c15.length) {
    throw new Error('No hay suficientes velas confirmadas');
  }

  const last = c5[c5.length - 1];
  const price = last.close;

  const trend = trendFromPivots(c15);

  const { support, resistance } =
    nearestLevels(c5, price);

  const tolerance = 0.0006;
  const buffer = 0.0003;

  const bullishCandle = last.close > last.open;
  const bearishCandle = last.close < last.open;

  const atSupport =
    last.low <= support * (1 + tolerance) &&
    last.close >= support;

  const atResistance =
    last.high >= resistance * (1 - tolerance) &&
    last.close <= resistance;

  const trendDefined =
    trend.trend === 'BULLISH' ||
    trend.trend === 'BEARISH';

  let zoneOk = false;
  let candleOk = false;

  if (trend.trend === 'BULLISH') {
    zoneOk = atSupport;
    candleOk = bullishCandle;
  }

  if (trend.trend === 'BEARISH') {
    zoneOk = atResistance;
    candleOk = bearishCandle;
  }

  const checklist = [
    {
      label: 'Tendencia 15M definida',
      pass: trendDefined
    },
    {
      label:
        trend.trend === 'BEARISH'
          ? 'Precio en zona de resistencia'
          : 'Precio en zona de soporte',
      pass: zoneOk
    },
    {
      label:
        trend.trend === 'BEARISH'
          ? 'Vela 5M confirma venta'
          : 'Vela 5M confirma compra',
      pass: candleOk
    }
  ];

  const passedChecks =
    checklist.filter(x => x.pass).length;

  const totalChecks = checklist.length;

  let side = null;
  let sl = null;
  let tp = null;
  let riskPips = null;

  if (
    trend.trend === 'BULLISH' &&
    atSupport &&
    bullishCandle
  ) {
    side = 'BUY';

    sl = support * (1 - buffer);

    const risk = price - sl;

    if (risk > 0) {
      tp = price + risk * 2;
      riskPips = risk / PIP;
    }
  }

  if (
    trend.trend === 'BEARISH' &&
    atResistance &&
    bearishCandle
  ) {
    side = 'SELL';

    sl = resistance * (1 + buffer);

    const risk = sl - price;

    if (risk > 0) {
      tp = price - risk * 2;
      riskPips = risk / PIP;
    }
  }

  return {
    verdict: side || 'NO_TRADE',

    pair: PAIR,

    price: Number(price.toFixed(3)),

    entry:
      side
        ? Number(price.toFixed(3))
        : null,

    sl:
      side && sl
        ? Number(sl.toFixed(3))
        : null,

    tp:
      side && tp
        ? Number(tp.toFixed(3))
        : null,

    rr: side ? 2 : null,

    riskPips:
      riskPips !== null
        ? Number(riskPips.toFixed(1))
        : null,

    support:
      Number(support.toFixed(3)),

    resistance:
      Number(resistance.toFixed(3)),

    trend,

    checklist,
    passedChecks,
    totalChecks,

    candleTime:
      new Date(last.t * 1000).toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    const [five, fifteen] = await Promise.all([
      fetchYahoo('5m', '5d'),
      fetchYahoo('15m', '10d')
    ]);

    const c5 =
      confirmedCandles(five.candles, 300);

    const c15 =
      confirmedCandles(fifteen.candles, 900);

    const analysis =
      analyze(c5, c15);

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
