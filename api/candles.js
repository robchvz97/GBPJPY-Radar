const SYMBOL = 'GBP/JPY';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    's-maxage=240, stale-while-revalidate=60'
  );
  res.end(JSON.stringify(body));
}

function parseUtc(datetime) {
  if (!datetime) return NaN;

  const normalized = datetime
    .replace(' ', 'T')
    .replace(/Z$/, '');

  return Date.parse(`${normalized}Z`) / 1000;
}

module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Falta TWELVE_DATA_API_KEY en Vercel'
      );
    }

    const url =
      `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(SYMBOL)}` +
      `&interval=5min` +
      `&outputsize=300` +
      `&order=asc` +
      `&timezone=UTC` +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!r.ok) {
      throw new Error(
        `Twelve Data HTTP ${r.status}`
      );
    }

    const data = await r.json();

    if (
      data.status === 'error' ||
      !Array.isArray(data.values)
    ) {
      throw new Error(
        data.message ||
        'Twelve Data no devolvió velas'
      );
    }

    const now =
      Math.floor(Date.now() / 1000);

    const candles = data.values
      .map(v => ({
        t: parseUtc(v.datetime),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close)
      }))
      .filter(c =>
        [c.t, c.open, c.high, c.low, c.close]
          .every(Number.isFinite)
      )
      .filter(c =>
        c.t + 300 <= now
      )
      .map(c => ({
        ...c,
        time:
          new Date(
            c.t * 1000
          ).toISOString(),
        closeTime:
          new Date(
            (c.t + 300) * 1000
          ).toISOString()
      }));

    json(res, 200, {
      ok: true,
      pair: SYMBOL,
      interval: '5min',
      source: 'Twelve Data',
      generatedAt:
        new Date().toISOString(),
      candles
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
