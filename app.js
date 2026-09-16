const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let current = null;

function fmt(n) {
  return Number.isFinite(Number(n))
    ? Number(n).toFixed(3)
    : '—';
}

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}

function signed(n, decimals = 2) {
  if (!Number.isFinite(Number(n))) return '—';
  const x = Number(n);
  return `${x > 0 ? '+' : ''}${x.toFixed(decimals)}`;
}

async function refresh() {
  $('#refreshBtn').disabled = true;

  try {
    await Promise.all([
      refreshMarket(),
      refreshPaper()
    ]);
  } finally {
    $('#refreshBtn').disabled = false;
  }
}

async function refreshMarket() {
  $('#feedStatus').className = 'dot-label';
  $('#feedStatus').innerHTML =
    '<i></i> Actualizando';

  try {
    const r = await fetch(
      '/api/market',
      { cache: 'no-store' }
    );

    const data = await r.json();

    if (!r.ok || !data.ok) {
      throw new Error(
        data.error || `HTTP ${r.status}`
      );
    }

    current = data;
    renderMarket(data);

  } catch (err) {
    $('#feedStatus').className =
      'dot-label bad';

    $('#feedStatus').innerHTML =
      '<i></i> Sin feed';

    $('#verdict').className =
      'verdict neutral';

    $('#verdict').textContent =
      'SIN DATOS';

    $('#signalSubtitle').textContent =
      err.message || String(err);
  }
}

function renderMarket(d) {
  $('#feedStatus').className =
    'dot-label ok';

  $('#feedStatus').innerHTML =
    '<i></i> Feed activo';

  $('#sourceText').textContent =
    `Feed: ${d.source}`;

  $('#price').textContent =
    fmt(d.price);

  $('#support').textContent =
    fmt(d.support);

  $('#resistance').textContent =
    fmt(d.resistance);

  $('#lastTime').textContent =
    new Date(d.candleTime)
      .toLocaleString(
        'es-MX',
        {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short'
        }
      );

  const trendMap = {
    BULLISH: 'ALCISTA',
    BEARISH: 'BAJISTA',
    NEUTRAL: 'NEUTRAL'
  };

  $('#trend').textContent =
    `${trendMap[d.trend.trend] || d.trend.trend} · ` +
    `${d.trend.highStructure}/${d.trend.lowStructure}`;

  $('#trend').className =
    d.trend.trend === 'BULLISH'
      ? 'trend-bull'
      : d.trend.trend === 'BEARISH'
        ? 'trend-bear'
        : '';

  $('#score').textContent =
    `${d.passedChecks}/${d.totalChecks}`;

  const v = $('#verdict');
  const plan = $('#tradePlan');

  if (
    d.verdict === 'BUY' ||
    d.verdict === 'SELL'
  ) {
    v.textContent =
      `${d.verdict} · TRADE`;

    v.className =
      `verdict ${d.verdict.toLowerCase()}`;

    $('#signalSubtitle').textContent =
      `Confluencia completa. Riesgo técnico: ${d.riskPips} pips.`;

    $('#entry').textContent =
      fmt(d.entry);

    $('#sl').textContent =
      fmt(d.sl);

    $('#tp').textContent =
      fmt(d.tp);

    $('#rr').textContent =
      '1:2';

    plan.classList.remove('hidden');

  } else {
    v.textContent =
      'NO TRADE';

    v.className =
      'verdict neutral';

    $('#signalSubtitle').textContent =
      `Faltan condiciones: ${d.totalChecks - d.passedChecks}. Esperar.`;

    plan.classList.add('hidden');
  }

  $('#recordSignalBtn')
    ?.classList.add('hidden');

  $('#checklist').innerHTML =
    (d.checklist || [])
      .map(c => `
        <div class="check ${c.pass ? 'pass' : ''}">
          <b>${c.pass ? '✓' : '×'}</b>
          <span>${escapeHtml(c.label)}</span>
        </div>
      `)
      .join('');
}

async function refreshPaper() {
  try {
    const r = await fetch(
      `/api/paper?t=${Date.now()}`,
      { cache: 'no-store' }
    );

    const data = await r.json();

    if (!r.ok || !data.ok) {
      throw new Error(
        data.error || `HTTP ${r.status}`
      );
    }

    renderPaper(data);

  } catch (err) {
    console.error(
      'Paper journal:',
      err
    );

    $('#journal').innerHTML = `
      <div class="empty">
        No se pudieron cargar las estadísticas automáticas.
      </div>
    `;
  }
}

function renderPaper(data) {
  const stats =
    data.stats || {};

  const list =
    Array.isArray(data.trades)
      ? data.trades
      : [];

  /*
    TARJETAS DE ESTADÍSTICAS
  */

  $('#statTrades').textContent =
    stats.totalSignals ?? list.length;

  $('#statWinRate').textContent =
    Number.isFinite(
      Number(stats.winRatePct)
    )
      ? `${Number(stats.winRatePct).toFixed(1)}%`
      : '—';

  $('#statR').textContent =
    Number.isFinite(
      Number(stats.totalR)
    )
      ? `${signed(stats.totalR)}R`
      : '0.00R';

  $('#statExpectancy').textContent =
    Number.isFinite(
      Number(stats.expectancyR)
    )
      ? `${signed(stats.expectancyR, 2)}R/trade`
      : '—';

  /*
    DIARIO
  */

  const journal =
    $('#journal');

  journal.innerHTML = '';

  $('#emptyJournal')
    .classList.toggle(
      'hidden',
      list.length > 0
    );

  /*
    RESUMEN GENERAL
  */

  const summary =
    document.createElement('article');

  summary.className = 'trade';

  const returnPct =
    Number.isFinite(
      Number(stats.simulatedReturnPct)
    )
      ? signed(
          stats.simulatedReturnPct,
          2
        )
      : '—';

  const balance =
    Number.isFinite(
      Number(
        stats.simulatedBalanceFrom100
      )
    )
      ? Number(
          stats.simulatedBalanceFrom100
        ).toFixed(2)
      : '—';

  const pf =
    Number.isFinite(
      Number(stats.profitFactor)
    )
      ? Number(
          stats.profitFactor
        ).toFixed(2)
      : '—';

  summary.innerHTML = `
    <div class="trade-top">
      <div>
        <div class="trade-side buy">
          PAPER TEST AUTOMÁTICO
        </div>
        <div class="trade-meta">
          Riesgo simulado: 1% por operación
        </div>
      </div>
    </div>

    <div class="trade-levels">
      <span>
        Abiertas
        <b>${stats.open ?? 0}</b>
      </span>

      <span>
        Ganadas
        <b>${stats.wins ?? 0}</b>
      </span>

      <span>
        Perdidas
        <b>${stats.losses ?? 0}</b>
      </span>
    </div>

    <div class="trade-notes">
      Profit Factor: <b>${pf}</b><br>
      Racha máxima de pérdidas:
      <b>${stats.maxLossStreak ?? 0}</b><br>
      Balance simulado:
      <b>${balance}</b><br>
      Rentabilidad simulada:
      <b>${returnPct}%</b>
    </div>
  `;

  journal.appendChild(summary);

  /*
    OPERACIONES
  */

  for (const t of list) {
    const div =
      document.createElement('article');

    div.className = 'trade';

    let resultText =
      'OPEN';

    let rText =
      '0R';

    let rClass =
      '';

    if (t.result === 'WIN') {
      resultText =
        'WIN +2R';

      rText =
        '+2R';

      rClass =
        'trend-bull';
    }

    if (t.result === 'LOSS') {
      resultText =
        'LOSS -1R';

      rText =
        '-1R';

      rClass =
        'trend-bear';
    }

    if (
      t.result === 'AMBIGUOUS'
    ) {
      resultText =
        'AMBIGUO';

      rText =
        '—';
    }

    const opened =
      t.candleTime
        ? new Date(
            t.candleTime
          ).toLocaleString(
            'es-MX'
          )
        : '—';

    const closed =
      t.closedAt
        ? new Date(
            t.closedAt
          ).toLocaleString(
            'es-MX'
          )
        : null;

    div.innerHTML = `
      <div class="trade-top">

        <div>
          <div class="trade-side ${String(t.side).toLowerCase()}">
            ${escapeHtml(t.side)}
            ·
            ${escapeHtml(resultText)}
          </div>

          <div class="trade-meta">
            ${opened}
            · PAPER AUTO
          </div>
        </div>

        <strong class="${rClass}">
          ${rText}
        </strong>

      </div>

      <div class="trade-levels">

        <span>
          Entrada
          <b>${fmt(t.entry)}</b>
        </span>

        <span>
          SL
          <b>${fmt(t.sl)}</b>
        </span>

        <span>
          TP
          <b>${fmt(t.tp)}</b>
        </span>

      </div>

      <div class="trade-notes">

        Tendencia 15M:
        <b>${escapeHtml(t.trend15m || '—')}</b>

        · Estructura:
        <b>${escapeHtml(t.structure || '—')}</b>

        · Checklist:
        <b>${escapeHtml(t.confluence || '—')}</b>

        ${
          t.riskPips
            ? `<br>Riesgo técnico: <b>${t.riskPips} pips</b>`
            : ''
        }

        ${
          closed
            ? `<br>Cerrada automáticamente: <b>${closed}</b>`
            : '<br>Estado: esperando TP o SL.'
        }

      </div>
    `;

    journal.appendChild(div);
  }
}

/*
  Ya no usamos el diario manual del navegador.
*/

if ($('#manualBtn')) {
  $('#manualBtn').style.display =
    'none';
}

if ($('#notifyBtn')) {
  $('#notifyBtn').style.display =
    'none';
}

if ($('#recordSignalBtn')) {
  $('#recordSignalBtn')
    .classList.add('hidden');
}

const journalSubtitle =
  document.querySelector(
    '.journal-card .muted.small'
  );

if (journalSubtitle) {
  journalSubtitle.textContent =
    'Resultados automáticos del paper test.';
}

const footerSpans =
  $$('footer span');

if (footerSpans[1]) {
  footerSpans[1].textContent =
    'Monitor automático activo en tus horarios aunque cierres la app.';
}

$('#refreshBtn').onclick =
  refresh;

if (
  'serviceWorker'
  in navigator
) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch(() => {});
}

refresh();

setInterval(
  refresh,
  5 * 60 * 1000
);
