const fs = require('fs');

const marketPath = process.argv[2] || 'market.json';
const candlesPath = process.argv[3] || 'candles.json';
const tradesPath = process.argv[4] || 'data/paper-trades.json';
const statsPath = 'data/paper-stats.json';

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  fs.writeFileSync(
    path,
    JSON.stringify(data, null, 2) + '\n'
  );
}

const market = readJson(marketPath, {});
const candleFeed = readJson(candlesPath, {});
let trades = readJson(tradesPath, []);

if (!Array.isArray(trades)) trades = [];

const candles = Array.isArray(candleFeed.candles)
  ? candleFeed.candles
  : [];

let changed = false;

/*
  1. Resolver operaciones abiertas
*/
for (const trade of trades) {
  if (trade.result !== 'OPEN') continue;

  const signalStart =
    new Date(trade.candleTime).getTime();

  if (!Number.isFinite(signalStart)) continue;

  // La entrada ocurre al cierre de la vela señal.
  // Por eso NO usamos la misma vela para evaluar TP/SL.
  const entryFrom =
    signalStart + 5 * 60 * 1000;

  const futureCandles = candles.filter(c => {
    const t = new Date(c.time).getTime();
    return Number.isFinite(t) && t >= entryFrom;
  });

  for (const candle of futureCandles) {
    const high = Number(candle.high);
    const low = Number(candle.low);

    let hitTp = false;
    let hitSl = false;

    if (trade.side === 'BUY') {
      hitTp = high >= Number(trade.tp);
      hitSl = low <= Number(trade.sl);
    }

    if (trade.side === 'SELL') {
      hitTp = low <= Number(trade.tp);
      hitSl = high >= Number(trade.sl);
    }

    if (!hitTp && !hitSl) continue;

    trade.closedAt =
      candle.closeTime || candle.time;

    if (hitTp && hitSl) {
      trade.result = 'AMBIGUOUS';
      trade.r = null;
      trade.note =
        'TP y SL fueron tocados dentro de la misma vela de 5M. No se cuenta en estadísticas.';
    } else if (hitTp) {
      trade.result = 'WIN';
      trade.r = 2;
    } else {
      trade.result = 'LOSS';
      trade.r = -1;
    }

    changed = true;
    break;
  }
}

/*
  2. Registrar nueva señal solamente cuando
  el workflow confirme que es una señal nueva.
*/
const newSignal =
  String(process.env.NEW_SIGNAL).toLowerCase() === 'true';

if (
  newSignal &&
  ['BUY', 'SELL'].includes(market.verdict)
) {
  const signalKey =
    `${market.verdict}_${market.candleTime}`;

  const alreadyExists =
    trades.some(t => t.signalKey === signalKey);

  if (!alreadyExists) {
    trades.push({
      id: signalKey,
      signalKey,
      pair: 'GBP/JPY',
      side: market.verdict,
      entry: Number(market.entry),
      sl: Number(market.sl),
      tp: Number(market.tp),
      rr: 2,
      riskPips: market.riskPips,
      candleTime: market.candleTime,
      detectedAt:
        market.generatedAt ||
        new Date().toISOString(),
      trend15m:
        market.trend?.trend || null,
      structure:
        `${market.trend?.highStructure || ''}/${market.trend?.lowStructure || ''}`,
      support: market.support,
      resistance: market.resistance,
      confluence:
        `${market.passedChecks}/${market.totalChecks}`,
      result: 'OPEN',
      r: null,
      closedAt: null,
      source: 'GBPJPY Radar'
    });

    changed = true;
  }
}

/*
  3. Orden cronológico
*/
trades.sort(
  (a, b) =>
    new Date(a.candleTime) -
    new Date(b.candleTime)
);

/*
  4. Estadísticas
*/
const wins =
  trades.filter(t => t.result === 'WIN');

const losses =
  trades.filter(t => t.result === 'LOSS');

const open =
  trades.filter(t => t.result === 'OPEN');

const ambiguous =
  trades.filter(t => t.result === 'AMBIGUOUS');

const validClosed =
  [...wins, ...losses];

const totalR =
  validClosed.reduce(
    (sum, t) => sum + Number(t.r || 0),
    0
  );

const winRate =
  validClosed.length
    ? wins.length / validClosed.length * 100
    : null;

const expectancy =
  validClosed.length
    ? totalR / validClosed.length
    : null;

const grossWinR =
  wins.length * 2;

const grossLossR =
  losses.length;

const profitFactor =
  grossLossR > 0
    ? grossWinR / grossLossR
    : wins.length
      ? null
      : null;

/*
  Simulación:
  1R = 1% del capital.
  WIN = +2%
  LOSS = -1%
*/
let equity = 100;

for (const trade of trades) {
  if (trade.result === 'WIN') {
    equity *= 1.02;
  }

  if (trade.result === 'LOSS') {
    equity *= 0.99;
  }
}

const simulatedReturnPct =
  equity - 100;

/*
  Máxima racha de pérdidas
*/
let currentLossStreak = 0;
let maxLossStreak = 0;

for (const trade of trades) {
  if (trade.result === 'LOSS') {
    currentLossStreak++;
    maxLossStreak = Math.max(
      maxLossStreak,
      currentLossStreak
    );
  } else if (trade.result === 'WIN') {
    currentLossStreak = 0;
  }
}

const stats = {
  updatedAt: new Date().toISOString(),

  totalSignals: trades.length,
  open: open.length,

  closedValid: validClosed.length,
  wins: wins.length,
  losses: losses.length,
  ambiguous: ambiguous.length,

  winRatePct:
    winRate === null
      ? null
      : Number(winRate.toFixed(2)),

  totalR:
    Number(totalR.toFixed(2)),

  expectancyR:
    expectancy === null
      ? null
      : Number(expectancy.toFixed(3)),

  profitFactor:
    profitFactor === null
      ? null
      : Number(profitFactor.toFixed(2)),

  maxLossStreak,

  simulatedRiskPerTradePct: 1,

  simulatedBalanceFrom100:
    Number(equity.toFixed(2)),

  simulatedReturnPct:
    Number(simulatedReturnPct.toFixed(2))
};

writeJson(tradesPath, trades);
writeJson(statsPath, stats);

console.log('PAPER JOURNAL');
console.log(JSON.stringify(stats, null, 2));

console.log(
  `changed=${changed ? 'true' : 'false'}`
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${changed ? 'true' : 'false'}\n`
  );
}
