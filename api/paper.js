const TRADES_URL =
  'https://raw.githubusercontent.com/robchvz97/GBPJPY-Radar/main/data/paper-trades.json';

const STATS_URL =
  'https://raw.githubusercontent.com/robchvz97/GBPJPY-Radar/main/data/paper-stats.json';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );
  res.setHeader(
    'Cache-Control',
    's-maxage=30, stale-while-revalidate=30'
  );
  res.end(JSON.stringify(body));
}

async function getJson(url) {
  const r = await fetch(
    `${url}?t=${Date.now()}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GBPJPY-Radar/1.0'
      }
    }
  );

  if (!r.ok) {
    throw new Error(`GitHub HTTP ${r.status}`);
  }

  return r.json();
}

module.exports = async function handler(req, res) {
  try {
    const [trades, stats] =
      await Promise.all([
        getJson(TRADES_URL),
        getJson(STATS_URL)
      ]);

    const sortedTrades =
      Array.isArray(trades)
        ? [...trades].sort(
            (a, b) =>
              new Date(b.candleTime) -
              new Date(a.candleTime)
          )
        : [];

    json(res, 200, {
      ok: true,
      stats,
      trades: sortedTrades,
      generatedAt:
        new Date().toISOString()
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
