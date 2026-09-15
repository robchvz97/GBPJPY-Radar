const SYMBOL = 'GBP/JPY';
const PAIR = 'GBP/JPY';
const PIP = 0.01;

const LOCAL_TZ = 'America/Mexico_City';
const FOREX_FACTORY_URL =
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

let calendarCache = {
  fetchedAt: 0,
  events: null
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseTwelveUtc(datetime) {
  if (!datetime) return NaN;

  const normalized = datetime
    .replace(' ', 'T')
    .replace(/Z$/, '');

  return Date.parse(`${normalized}Z`) / 1000;
}

async function fetchTwelveData(interval, outputsize = 250) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error('Falta TWELVE_DATA_API_KEY en Vercel');
  }

  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    `&interval=${interval}` +
    `&outputsize=${outputsize}` +
    `&order=asc` +
    `&timezone=UTC` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const r = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!r.ok) {
    throw new Error(`Twelve Data HTTP ${r.status}`);
  }

  const data = await r.json();

  if (data.status === 'error' || !Array.isArray(data.values)) {
    throw new Error(
      data.message ||
      data.code ||
      'Twelve Data no devolvió velas'
    );
  }

  const candles = data.values
    .map(v => ({
      t: parseTwelveUtc(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close)
    }))
    .filter(c =>
      [c.t, c.open, c.high, c.low, c.close]
        .every(Number.isFinite)
    );

  return candles;
}

function confirmedCandles(candles, seconds) {
  const now = Math.floor(Date.now() / 1000);

  const closed = candles.filter(
    c => c.t + seconds <= now
  );

  return closed.length
    ? closed
    : candles.slice(0, -1);
}

function getLocalParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const obj = {};

  for (const p of parts) {
    if (p.type !== 'literal') {
      obj[p.type] = p.value;
    }
  }

  return {
    weekday: obj.weekday,
    hour: Number(obj.hour),
    minute: Number(obj.minute)
  };
}

function sessionStatus(now = new Date()) {
  const local = getLocalParts(now);

  const minutes =
    local.hour * 60 + local.minute;

  const morning =
    minutes >= 6 * 60 &&
    minutes < 11 * 60;

  const evening =
    minutes >= 20 * 60 &&
    minutes < 23 * 60;

  const morningDays =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const eveningDays =
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

  const morningAllowed =
    morning &&
    morningDays.includes(local.weekday);

  const eveningAllowed =
    evening &&
    eveningDays.includes(local.weekday);

  const allowed =
    morningAllowed || eveningAllowed;

  let window = 'FUERA DE HORARIO';

  if (morningAllowed) {
    window = '06:00–11:00';
  }

  if (eveningAllowed) {
    window = '20:00–23:00';
  }

  return {
    allowed,
    window,
    timezone: LOCAL_TZ,
    weekday: local.weekday,
    hour: local.hour,
    minute: local.minute
  };
}

async function fetchForexFactoryCalendar() {
  const now = Date.now();

  // Forex Factory actualiza el archivo aprox. cada hora.
  // Evitamos pedirlo constantemente.
  if (
    calendarCache.events &&
    now - calendarCache.fetchedAt <
      55 * 60 * 1000
  ) {
    return calendarCache.events;
  }

  const r = await fetch(FOREX_FACTORY_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GBPJPY-Radar/1.0'
    }
  });

  if (!r.ok) {
    throw new Error(
      `Forex Factory HTTP ${r.status}`
    );
  }

  const events = await r.json();

  if (!Array.isArray(events)) {
    throw new Error(
      'Forex Factory no devolvió calendario válido'
    );
  }

  calendarCache = {
    fetchedAt: now,
    events
  };

  return events;
}

function isExtendedCentralBankEvent(title = '') {
  const t = title.toLowerCase();

  const keywords = [
    'official bank rate',
    'bank rate',
    'monetary policy',
    'mpc',
    'boe',
    'boj',
    'policy rate',
    'interest rate',
    'rate statement',
    'press conference'
  ];

  return keywords.some(k => t.includes(k));
}

function evaluateNews(events, now = new Date()) {
  const nowMs = now.getTime();

  const relevant = events
    .filter(e =>
      ['GBP', 'JPY'].includes(e.country) &&
      String(e.impact).toLowerCase() === 'high'
    )
    .map(e => ({
      ...e,
      timestamp: new Date(e.date).getTime()
    }))
    .filter(e => Number.isFinite(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  let blockedEvent = null;

  for (const event of relevant) {
    const extended =
      isExtendedCentralBankEvent(event.title);

    const beforeMs =
      30 * 60 * 1000;

    const afterMs =
      (extended ? 60 : 30) *
      60 * 1000;

    const blockStart =
      event.timestamp - beforeMs;

    const blockEnd =
      event.timestamp + afterMs;

    if (
      nowMs >= blockStart &&
      nowMs <= blockEnd
    ) {
      blockedEvent = {
        title: event.title,
        currency: event.country,
        impact: event.impact,
        date: event.date,
        timestamp: event.timestamp,
        extended
      };

      break;
    }
  }

  const nextEvent =
    relevant.find(e => e.timestamp > nowMs);

  return {
    clear: !blockedEvent,
    blocked: Boolean(blockedEvent),

    blockedEvent,

    nextHighImpact: nextEvent
      ? {
          title: nextEvent.title,
          currency: nextEvent.country,
          date: nextEvent.date,
          minutesAway: Math.round(
            (nextEvent.timestamp - nowMs) /
            60000
          )
        }
      : null
  };
}

function getPivots(candles, len = 3) {
  const highs = [];
  const lows = [];

  for (
    let i = len;
    i < candles.length - len;
    i++
  ) {
    let isHigh = true;
    let isLow = true;

    for (
      let j = i - len;
      j <= i + len;
      j++
    ) {
      if (j === i) continue;

      if (
        candles[j].high >=
        candles[i].high
      ) {
        isHigh = false;
      }

      if (
        candles[j].low <=
        candles[i].low
      ) {
        isLow = false;
      }
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
  const { highs, lows } =
    getPivots(candles, 3);

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return {
      trend: 'NEUTRAL',
      highStructure: 'N/A',
      lowStructure: 'N/A'
    };
  }

  const prevHigh =
    highs[highs.length - 2].price;

  const lastHigh =
    highs[highs.length - 1].price;

  const prevLow =
    lows[lows.length - 2].price;

  const lastLow =
    lows[lows.length - 1].price;

  const highStructure =
    lastHigh > prevHigh
      ? 'HH'
      : lastHigh < prevHigh
        ? 'LH'
        : 'EQ';

  const lowStructure =
    lastLow > prevLow
      ? 'HL'
      : lastLow < prevLow
        ? 'LL'
        : 'EQ';

  let trend = 'NEUTRAL';

  if (
    highStructure === 'HH' &&
    lowStructure === 'HL'
  ) {
    trend = 'BULLISH';
  }

  if (
    highStructure === 'LH' &&
    lowStructure === 'LL'
  ) {
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
  const { highs, lows } =
    getPivots(candles, 3);

  const supports = lows
    .map(x => x.price)
    .filter(p => p <= price);

  const resistances = highs
    .map(x => x.price)
    .filter(p => p >= price);

  const recent =
    candles.slice(-60);

  const support =
    supports.length
      ? Math.max(...supports)
      : Math.min(
          ...recent.map(c => c.low)
        );

  const resistance =
    resistances.length
      ? Math.min(...resistances)
      : Math.max(
          ...recent.map(c => c.high)
        );

  return {
    support,
    resistance
  };
}

function analyze(
  c5,
  c15,
  session,
  news
) {
  if (
    !c5.length ||
    !c15.length
  ) {
    throw new Error(
      'No hay suficientes velas confirmadas'
    );
  }

  const last =
    c5[c5.length - 1];

  const price =
    last.close;

  const trend =
    trendFromPivots(c15);

  const {
    support,
    resistance
  } = nearestLevels(
    c5,
    price
  );

  const tolerance =
    0.0006;

  const buffer =
    0.0003;

  const bullishCandle =
    last.close > last.open;

  const bearishCandle =
    last.close < last.open;

  const atSupport =
    last.low <=
      support *
        (1 + tolerance) &&
    last.close >= support;

  const atResistance =
    last.high >=
      resistance *
        (1 - tolerance) &&
    last.close <= resistance;

  const trendDefined =
    trend.trend === 'BULLISH' ||
    trend.trend === 'BEARISH';

  let zoneOk = false;
  let candleOk = false;

  if (
    trend.trend === 'BULLISH'
  ) {
    zoneOk = atSupport;
    candleOk = bullishCandle;
  }

  if (
    trend.trend === 'BEARISH'
  ) {
    zoneOk = atResistance;
    candleOk = bearishCandle;
  }

  const checklist = [
    {
      label:
        'Horario permitido Guadalajara',
      pass: session.allowed
    },
    {
      label:
        news.clear
          ? 'Sin noticia High Impact GBP/JPY'
          : `BLOQUEO: ${news.blockedEvent.currency} · ${news.blockedEvent.title}`,
      pass: news.clear
    },
    {
      label:
        'Tendencia 15M definida',
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
    checklist.filter(
      x => x.pass
    ).length;

  const totalChecks =
    checklist.length;

  const allFiltersPass =
    session.allowed &&
    news.clear &&
    trendDefined &&
    zoneOk &&
    candleOk;

  let side = null;
  let sl = null;
  let tp = null;
  let riskPips = null;

  if (
    allFiltersPass &&
    trend.trend === 'BULLISH'
  ) {
    side = 'BUY';

    sl =
      support *
      (1 - buffer);

    const risk =
      price - sl;

    if (risk > 0) {
      tp =
        price +
        risk * 2;

      riskPips =
        risk / PIP;
    }
  }

  if (
    allFiltersPass &&
    trend.trend === 'BEARISH'
  ) {
    side = 'SELL';

    sl =
      resistance *
      (1 + buffer);

    const risk =
      sl - price;

    if (risk > 0) {
      tp =
        price -
        risk * 2;

      riskPips =
        risk / PIP;
    }
  }

  return {
    verdict:
      side || 'NO_TRADE',

    pair: PAIR,

    price:
      Number(
        price.toFixed(3)
      ),

    entry:
      side
        ? Number(
            price.toFixed(3)
          )
        : null,

    sl:
      side && sl
        ? Number(
            sl.toFixed(3)
          )
        : null,

    tp:
      side && tp
        ? Number(
            tp.toFixed(3)
          )
        : null,

    rr:
      side ? 2 : null,

    riskPips:
      riskPips !== null
        ? Number(
            riskPips.toFixed(1)
          )
        : null,

    support:
      Number(
        support.toFixed(3)
      ),

    resistance:
      Number(
        resistance.toFixed(3)
      ),

    trend,

    session,

    news,

    checklist,

    passedChecks,

    totalChecks,

    candleTime:
      new Date(
        last.t * 1000
      ).toISOString()
  };
}

module.exports =
async function handler(req, res) {
  try {
    const session =
      sessionStatus();

    let news;

    try {
      const events =
        await fetchForexFactoryCalendar();

      news =
        evaluateNews(events);

    } catch (newsErr) {
      // Si no podemos comprobar noticias,
      // bloqueamos por seguridad.
      news = {
        clear: false,
        blocked: true,
        unavailable: true,
        error:
          newsErr?.message ||
          String(newsErr),

        blockedEvent: {
          currency: 'N/A',
          title:
            'Calendario económico no disponible'
        },

        nextHighImpact: null
      };
    }

    const [
      fiveRaw,
      fifteenRaw
    ] = await Promise.all([
      fetchTwelveData(
        '5min',
        300
      ),

      fetchTwelveData(
        '15min',
        250
      )
    ]);

    const c5 =
      confirmedCandles(
        fiveRaw,
        300
      );

    const c15 =
      confirmedCandles(
        fifteenRaw,
        900
      );

    const analysis =
      analyze(
        c5,
        c15,
        session,
        news
      );

    json(res, 200, {
      ok: true,

      source:
        'Twelve Data',

      calendarSource:
        'Forex Factory',

      generatedAt:
        new Date().toISOString(),

      ...analysis
    });

  } catch (err) {
    json(res, 502, {
      ok: false,

      error:
        err?.message ||
        String(err)
    });
  }
};
