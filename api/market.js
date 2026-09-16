const SYMBOL = 'GBP/JPY';
const PAIR = 'GBP/JPY';
const PIP = 0.01;

// Parámetros EXACTOS del Pine
const PIVOT_LEN = 3;
const ZONA_PCT = 0.05;
const SL_BUFFER_PCT = 0.03;
const COOLDOWN_BARS = 10;
const RR = 2;

const LOCAL_TZ = 'America/Mexico_City';

const FOREX_FACTORY_URL =
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

let calendarCache = {
  fetchedAt: 0,
  events: null
};

function json(res, status, body) {
  res.statusCode = status;

  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  res.end(
    JSON.stringify(body)
  );
}

function parseTwelveUtc(datetime) {
  if (!datetime) return NaN;

  const normalized = datetime
    .replace(' ', 'T')
    .replace(/Z$/, '');

  return (
    Date.parse(
      `${normalized}Z`
    ) / 1000
  );
}

async function fetchTwelveData(
  interval,
  outputsize
) {
  const apiKey =
    process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Falta TWELVE_DATA_API_KEY en Vercel'
    );
  }

  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    `&interval=${interval}` +
    `&outputsize=${outputsize}` +
    `&order=asc` +
    `&timezone=UTC` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const r = await fetch(
    url,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  if (!r.ok) {
    throw new Error(
      `Twelve Data HTTP ${r.status}`
    );
  }

  const data =
    await r.json();

  if (
    data.status === 'error' ||
    !Array.isArray(data.values)
  ) {
    throw new Error(
      data.message ||
      data.code ||
      'Twelve Data no devolvió velas'
    );
  }

  return data.values
    .map(v => ({
      t:
        parseTwelveUtc(
          v.datetime
        ),

      open:
        Number(v.open),

      high:
        Number(v.high),

      low:
        Number(v.low),

      close:
        Number(v.close)
    }))
    .filter(c =>
      [
        c.t,
        c.open,
        c.high,
        c.low,
        c.close
      ].every(
        Number.isFinite
      )
    );
}

function confirmedCandles(
  candles,
  seconds
) {
  const now =
    Math.floor(
      Date.now() / 1000
    );

  const closed =
    candles.filter(
      c =>
        c.t + seconds <= now
    );

  return closed.length
    ? closed
    : candles.slice(0, -1);
}

function getLocalParts(
  date
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: LOCAL_TZ,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }
    ).formatToParts(date);

  const obj = {};

  for (const p of parts) {
    if (
      p.type !== 'literal'
    ) {
      obj[p.type] =
        p.value;
    }
  }

  return {
    weekday:
      obj.weekday,

    hour:
      Number(obj.hour),

    minute:
      Number(obj.minute)
  };
}

function sessionStatusAt(
  date
) {
  const local =
    getLocalParts(date);

  const minutes =
    local.hour * 60 +
    local.minute;

  const morning =
    minutes >= 6 * 60 &&
    minutes < 11 * 60;

  const evening =
    minutes >= 20 * 60 &&
    minutes < 23 * 60;

  const morningDays = [
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri'
  ];

  const eveningDays = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu'
  ];

  const morningAllowed =
    morning &&
    morningDays.includes(
      local.weekday
    );

  const eveningAllowed =
    evening &&
    eveningDays.includes(
      local.weekday
    );

  const allowed =
    morningAllowed ||
    eveningAllowed;

  let window =
    'FUERA DE HORARIO';

  if (morningAllowed) {
    window =
      '06:00–11:00';
  }

  if (eveningAllowed) {
    window =
      '20:00–23:00';
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
  const now =
    Date.now();

  if (
    calendarCache.events &&
    now -
      calendarCache.fetchedAt <
      55 * 60 * 1000
  ) {
    return (
      calendarCache.events
    );
  }

  const r =
    await fetch(
      FOREX_FACTORY_URL,
      {
        headers: {
          Accept:
            'application/json',

          'User-Agent':
            'GBPJPY-Radar/1.0'
        }
      }
    );

  if (!r.ok) {
    throw new Error(
      `Forex Factory HTTP ${r.status}`
    );
  }

  const events =
    await r.json();

  if (
    !Array.isArray(events)
  ) {
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

function isExtendedCentralBankEvent(
  title = ''
) {
  const t =
    title.toLowerCase();

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

  return keywords.some(
    k => t.includes(k)
  );
}

function evaluateNews(
  events,
  atDate
) {
  const atMs =
    atDate.getTime();

  const relevant =
    events
      .filter(e =>
        ['GBP', 'JPY']
          .includes(e.country) &&

        String(e.impact)
          .toLowerCase() ===
          'high'
      )
      .map(e => ({
        ...e,

        timestamp:
          new Date(
            e.date
          ).getTime()
      }))
      .filter(e =>
        Number.isFinite(
          e.timestamp
        )
      )
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      );

  let blockedEvent =
    null;

  for (
    const event
    of relevant
  ) {
    const extended =
      isExtendedCentralBankEvent(
        event.title
      );

    const beforeMs =
      30 * 60 * 1000;

    const afterMs =
      (
        extended
          ? 60
          : 30
      ) *
      60 *
      1000;

    if (
      atMs >=
        event.timestamp -
          beforeMs &&

      atMs <=
        event.timestamp +
          afterMs
    ) {
      blockedEvent = {
        title:
          event.title,

        currency:
          event.country,

        impact:
          event.impact,

        date:
          event.date,

        timestamp:
          event.timestamp,

        extended
      };

      break;
    }
  }

  const nextEvent =
    relevant.find(
      e =>
        e.timestamp > atMs
    );

  return {
    clear:
      !blockedEvent,

    blocked:
      Boolean(
        blockedEvent
      ),

    blockedEvent,

    nextHighImpact:
      nextEvent
        ? {
            title:
              nextEvent.title,

            currency:
              nextEvent.country,

            date:
              nextEvent.date,

            minutesAway:
              Math.round(
                (
                  nextEvent.timestamp -
                  atMs
                ) /
                60000
              )
          }
        : null
  };
}

/*
  Replica ta.pivothigh()
  y ta.pivotlow()
*/
function buildConfirmedPivots(
  candles,
  intervalSeconds
) {
  const highs = [];
  const lows = [];

  for (
    let i = PIVOT_LEN;
    i <
      candles.length -
        PIVOT_LEN;
    i++
  ) {
    let isHigh = true;
    let isLow = true;

    for (
      let j =
        i - PIVOT_LEN;

      j <=
        i + PIVOT_LEN;

      j++
    ) {
      if (j === i) {
        continue;
      }

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

    const confirmBar =
      candles[
        i + PIVOT_LEN
      ];

    const availableT =
      confirmBar.t +
      intervalSeconds;

    if (isHigh) {
      highs.push({
        price:
          candles[i].high,

        pivotT:
          candles[i].t,

        availableT
      });
    }

    if (isLow) {
      lows.push({
        price:
          candles[i].low,

        pivotT:
          candles[i].t,

        availableT
      });
    }
  }

  return {
    highs,
    lows
  };
}

function availablePivots(
  list,
  cutoffT
) {
  return list.filter(
    p =>
      p.availableT <=
      cutoffT
  );
}

function latestPivotPrice(
  list,
  cutoffT
) {
  const a =
    availablePivots(
      list,
      cutoffT
    );

  return a.length
    ? a[
        a.length - 1
      ].price
    : null;
}

function structureAt(
  pivots15,
  cutoffT
) {
  const highs =
    availablePivots(
      pivots15.highs,
      cutoffT
    );

  const lows =
    availablePivots(
      pivots15.lows,
      cutoffT
    );

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return {
      trend: 'NEUTRAL',

      highStructure:
        'N/A',

      lowStructure:
        'N/A',

      lastHigh:
        highs.length
          ? highs[
              highs.length -
                1
            ].price
          : null,

      prevHigh:
        highs.length > 1
          ? highs[
              highs.length -
                2
            ].price
          : null,

      lastLow:
        lows.length
          ? lows[
              lows.length -
                1
            ].price
          : null,

      prevLow:
        lows.length > 1
          ? lows[
              lows.length -
                2
            ].price
          : null
    };
  }

  const lastHigh =
    highs[
      highs.length - 1
    ].price;

  const prevHigh =
    highs[
      highs.length - 2
    ].price;

  const lastLow =
    lows[
      lows.length - 1
    ].price;

  const prevLow =
    lows[
      lows.length - 2
    ].price;

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

  let trend =
    'NEUTRAL';

  if (
    highStructure === 'HH' &&
    lowStructure === 'HL'
  ) {
    trend =
      'BULLISH';
  }

  if (
    highStructure === 'LH' &&
    lowStructure === 'LL'
  ) {
    trend =
      'BEARISH';
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

/*
  Replica el Pine barra por barra.
  Esto conserva el cooldown
  de 10 velas.
*/
function simulatePine(
  c5,
  c15
) {
  const pivots5 =
    buildConfirmedPivots(
      c5,
      300
    );

  const pivots15 =
    buildConfirmedPivots(
      c15,
      900
    );

  let lastSignalIndex =
    null;

  const signals = [];

  let currentState =
    null;

  for (
    let i = 0;
    i < c5.length;
    i++
  ) {
    const bar =
      c5[i];

    const closeT =
      bar.t + 300;

    const trend =
      structureAt(
        pivots15,
        closeT
      );

    const support =
      latestPivotPrice(
        pivots5.lows,
        closeT
      );

    const resistance =
      latestPivotPrice(
        pivots5.highs,
        closeT
      );

    const zonaSoporteSuperior =
      support !== null
        ? support *
          (
            1 +
            ZONA_PCT /
              100
          )
        : null;

    const zonaResistenciaInferior =
      resistance !== null
        ? resistance *
          (
            1 -
            ZONA_PCT /
              100
          )
        : null;

    const velaAlcista =
      bar.close >
      bar.open;

    const velaBajista =
      bar.close <
      bar.open;

    const tocaSoporte =
      support !== null &&

      bar.low <=
        zonaSoporteSuperior &&

      bar.close >
        support;

    const tocaResistencia =
      resistance !== null &&

      bar.high >=
        zonaResistenciaInferior &&

      bar.close <
        resistance;

    const tendenciaAlcista =
      trend.trend ===
      'BULLISH';

    const tendenciaBajista =
      trend.trend ===
      'BEARISH';

    const setupCompra =
      tendenciaAlcista &&
      tocaSoporte &&
      velaAlcista;

    const setupVenta =
      tendenciaBajista &&
      tocaResistencia &&
      velaBajista;

    const puedeDarSenal =
      lastSignalIndex ===
        null ||

      i -
        lastSignalIndex >=
        COOLDOWN_BARS;

    const buySignal =
      setupCompra &&
      puedeDarSenal;

    const sellSignal =
      setupVenta &&
      puedeDarSenal;

    let signal =
      null;

    if (buySignal) {
      const entry =
        bar.close;

      const sl =
        support *
        (
          1 -
          SL_BUFFER_PCT /
            100
        );

      const risk =
        entry - sl;

      if (risk > 0) {
        signal = {
          side:
            'BUY',

          entry,

          sl,

          tp:
            entry +
            risk * RR,

          riskPips:
            risk /
            PIP,

          candleTime:
            new Date(
              bar.t *
                1000
            ).toISOString(),

          candleCloseTime:
            new Date(
              closeT *
                1000
            ).toISOString(),

          barIndex: i
        };
      }
    }

    if (sellSignal) {
      const entry =
        bar.close;

      const sl =
        resistance *
        (
          1 +
          SL_BUFFER_PCT /
            100
        );

      const risk =
        sl - entry;

      if (risk > 0) {
        signal = {
          side:
            'SELL',

          entry,

          sl,

          tp:
            entry -
            risk * RR,

          riskPips:
            risk /
            PIP,

          candleTime:
            new Date(
              bar.t *
                1000
            ).toISOString(),

          candleCloseTime:
            new Date(
              closeT *
                1000
            ).toISOString(),

          barIndex: i
        };
      }
    }

    if (signal) {
      lastSignalIndex =
        i;

      signals.push(
        signal
      );
    }

    currentState = {
      bar,
      closeT,
      trend,
      support,
      resistance,
      zonaSoporteSuperior,
      zonaResistenciaInferior,
      velaAlcista,
      velaBajista,
      tocaSoporte,
      tocaResistencia,
      setupCompra,
      setupVenta,
      puedeDarSenal,
      signal
    };
  }

  return {
    currentState,

    latestPineSignal:
      signals.length
        ? signals[
            signals.length -
              1
          ]
        : null,

    signalCountInLoadedHistory:
      signals.length
  };
}

function round3(n) {
  return Number.isFinite(
    Number(n)
  )
    ? Number(
        Number(n)
          .toFixed(3)
      )
    : null;
}

function buildAnalysis(
  sim,
  session,
  news
) {
  const s =
    sim.currentState;

  if (!s) {
    throw new Error(
      'No hay suficientes velas confirmadas'
    );
  }

  const pineSignal =
    s.signal;

  const trendDefined =
    [
      'BULLISH',
      'BEARISH'
    ].includes(
      s.trend.trend
    );

  let zoneOk =
    false;

  let candleOk =
    false;

  if (
    s.trend.trend ===
    'BULLISH'
  ) {
    zoneOk =
      s.tocaSoporte;

    candleOk =
      s.velaAlcista;
  }

  if (
    s.trend.trend ===
    'BEARISH'
  ) {
    zoneOk =
      s.tocaResistencia;

    candleOk =
      s.velaBajista;
  }

  const checklist = [
    {
      label:
        'Horario permitido Guadalajara',

      pass:
        session.allowed
    },

    {
      label:
        news.clear
          ? 'Sin noticia High Impact GBP/JPY'
          : `BLOQUEO: ${news.blockedEvent.currency} · ${news.blockedEvent.title}`,

      pass:
        news.clear
    },

    {
      label:
        'Tendencia 15M Pine definida',

      pass:
        trendDefined
    },

    {
      label:
        s.trend.trend ===
          'BEARISH'
          ? 'Precio toca resistencia Pine 5M'
          : s.trend.trend ===
              'BULLISH'
            ? 'Precio toca soporte Pine 5M'
            : 'Precio en zona Pine 5M',

      pass:
        zoneOk
    },

    {
      label:
        s.trend.trend ===
          'BEARISH'
          ? 'Vela 5M bajista'
          : s.trend.trend ===
              'BULLISH'
            ? 'Vela 5M alcista'
            : 'Vela 5M de confirmación',

      pass:
        candleOk
    },

    {
      label:
        `Cooldown Pine disponible (${COOLDOWN_BARS} velas)`,

      pass:
        s.puedeDarSenal
    }
  ];

  const filtersPass =
    session.allowed &&
    news.clear;

  const finalSignal =
    pineSignal &&
    filtersPass
      ? pineSignal
      : null;

  return {
    verdict:
      finalSignal
        ? finalSignal.side
        : 'NO_TRADE',

    pair:
      PAIR,

    price:
      round3(
        s.bar.close
      ),

    entry:
      finalSignal
        ? round3(
            finalSignal.entry
          )
        : null,

    sl:
      finalSignal
        ? round3(
            finalSignal.sl
          )
        : null,

    tp:
      finalSignal
        ? round3(
            finalSignal.tp
          )
        : null,

    rr:
      finalSignal
        ? RR
        : null,

    riskPips:
      finalSignal
        ? Number(
            finalSignal
              .riskPips
              .toFixed(1)
          )
        : null,

    support:
      round3(
        s.support
      ),

    resistance:
      round3(
        s.resistance
      ),

    trend:
      s.trend,

    session,

    news,

    checklist,

    passedChecks:
      checklist.filter(
        x => x.pass
      ).length,

    totalChecks:
      checklist.length,

    candleTime:
      new Date(
        s.bar.t *
          1000
      ).toISOString(),

    candleCloseTime:
      new Date(
        s.closeT *
          1000
      ).toISOString(),

    pine: {
      exactParameters: {
        pivotLen:
          PIVOT_LEN,

        zonaPct:
          ZONA_PCT,

        slBufferPct:
          SL_BUFFER_PCT,

        cooldownBars:
          COOLDOWN_BARS,

        rr:
          RR
      },

      signalOnCurrentClosedBar:
        pineSignal
          ? {
              side:
                pineSignal.side,

              entry:
                round3(
                  pineSignal.entry
                ),

              sl:
                round3(
                  pineSignal.sl
                ),

              tp:
                round3(
                  pineSignal.tp
                ),

              riskPips:
                Number(
                  pineSignal
                    .riskPips
                    .toFixed(1)
                ),

              candleTime:
                pineSignal
                  .candleTime
            }
          : null,

      latestSignalInLoadedHistory:
        sim.latestPineSignal
          ? {
              side:
                sim
                  .latestPineSignal
                  .side,

              entry:
                round3(
                  sim
                    .latestPineSignal
                    .entry
                ),

              sl:
                round3(
                  sim
                    .latestPineSignal
                    .sl
                ),

              tp:
                round3(
                  sim
                    .latestPineSignal
                    .tp
                ),

              candleTime:
                sim
                  .latestPineSignal
                  .candleTime
            }
          : null,

      signalCountInLoadedHistory:
        sim
          .signalCountInLoadedHistory
    }
  };
}

module.exports =
async function handler(
  req,
  res
) {
  try {
    const [
      fiveRaw,
      fifteenRaw
    ] =
      await Promise.all([
        fetchTwelveData(
          '5min',
          600
        ),

        fetchTwelveData(
          '15min',
          400
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

    if (
      c5.length < 30 ||
      c15.length < 30
    ) {
      throw new Error(
        'No hay suficientes velas para replicar Pine'
      );
    }

    const sim =
      simulatePine(
        c5,
        c15
      );

    const last =
      sim.currentState;

    const signalCloseDate =
      new Date(
        last.closeT *
          1000
      );

    const session =
      sessionStatusAt(
        signalCloseDate
      );

    let news;

    try {
      const events =
        await fetchForexFactoryCalendar();

      news =
        evaluateNews(
          events,
          signalCloseDate
        );

    } catch (newsErr) {
      news = {
        clear: false,
        blocked: true,
        unavailable: true,

        error:
          newsErr?.message ||
          String(newsErr),

        blockedEvent: {
          currency:
            'N/A',

          title:
            'Calendario económico no disponible'
        },

        nextHighImpact:
          null
      };
    }

    const analysis =
      buildAnalysis(
        sim,
        session,
        news
      );

    json(
      res,
      200,
      {
        ok: true,

        source:
          'Twelve Data',

        strategy:
          'Pine GBPJPY Radar v1 sincronizada',

        calendarSource:
          'Forex Factory',

        generatedAt:
          new Date()
            .toISOString(),

        ...analysis
      }
    );

  } catch (err) {
    json(
      res,
      502,
      {
        ok: false,

        error:
          err?.message ||
          String(err)
      }
    );
  }
};
