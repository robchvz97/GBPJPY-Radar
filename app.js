const $ = s => document.querySelector(s);

let current = null;


/* =========================
   UTILIDADES
   ========================= */

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
  if (!Number.isFinite(Number(n))) {
    return '—';
  }

  const x = Number(n);

  return `${x > 0 ? '+' : ''}${x.toFixed(decimals)}`;
}

function localDate(value) {
  if (!value) {
    return '—';
  }

  return new Date(value)
    .toLocaleString(
      'es-MX',
      {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
}


/* =========================
   PESTAÑAS
   ========================= */

function showTab(tab) {
  const radar =
    tab === 'radar';

  $('#radarTab')
    .classList.toggle(
      'hidden',
      !radar
    );

  $('#historyTab')
    .classList.toggle(
      'hidden',
      radar
    );

  $('#radarTabBtn')
    .classList.toggle(
      'active',
      radar
    );

  $('#historyTabBtn')
    .classList.toggle(
      'active',
      !radar
    );

  localStorage.setItem(
    'gbpjpy_active_tab',
    tab
  );
}

$('#radarTabBtn').onclick =
  () => showTab('radar');

$('#historyTabBtn').onclick =
  () => showTab('history');


/* =========================
   ACTUALIZACIÓN GENERAL
   ========================= */

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


/* =========================
   RADAR
   ========================= */

async function refreshMarket() {
  $('#feedStatus').className =
    'dot-label';

  $('#feedStatus').innerHTML =
    '<i></i> Actualizando';

  try {
    const r = await fetch(
      `/api/market?t=${Date.now()}`,
      {
        cache: 'no-store'
      }
    );

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        `HTTP ${r.status}`
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
      err.message ||
      String(err);
  }
}


function renderMarket(d) {
  $('#feedStatus').className =
    'dot-label ok';

  $('#feedStatus').innerHTML =
    '<i></i> Feed activo';

  $('#sourceText').textContent =
    d.strategy
      ? `Feed: ${d.source} · Pine sincronizado`
      : `Feed: ${d.source}`;

  $('#price').textContent =
    fmt(d.price);

  $('#support').textContent =
    fmt(d.support);

  $('#resistance').textContent =
    fmt(d.resistance);

  $('#lastTime').textContent =
    d.candleTime
      ? new Date(
          d.candleTime
        ).toLocaleString(
          'es-MX',
          {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short'
          }
        )
      : '—';


  const trend =
    d.trend || {};

  const trendMap = {
    BULLISH: 'ALCISTA',
    BEARISH: 'BAJISTA',
    NEUTRAL: 'NEUTRAL'
  };

  $('#trend').textContent =
    `${trendMap[trend.trend] || trend.trend || '—'} · ` +
    `${trend.highStructure || '—'}/${trend.lowStructure || '—'}`;

  $('#trend').className =
    trend.trend === 'BULLISH'
      ? 'trend-bull'
      : trend.trend === 'BEARISH'
        ? 'trend-bear'
        : '';

  $('#score').textContent =
    `${d.passedChecks}/${d.totalChecks}`;


  const verdict =
    $('#verdict');

  const plan =
    $('#tradePlan');


  if (
    d.verdict === 'BUY' ||
    d.verdict === 'SELL'
  ) {
    verdict.textContent =
      `${d.verdict} · TRADE`;

    verdict.className =
      `verdict ${d.verdict.toLowerCase()}`;

    $('#signalSubtitle').textContent =
      `Tendencia, nivel y price action confirmados. Riesgo técnico: ${d.riskPips} pips.`;

    $('#entry').textContent =
      fmt(d.entry);

    $('#sl').textContent =
      fmt(d.sl);

    $('#tp').textContent =
      fmt(d.tp);

    $('#rr').textContent =
      '1:2';

    plan.classList.remove(
      'hidden'
    );

  } else if (d.verdict === 'SETUP_FORMING') {
    verdict.textContent =
      'SETUP EN FORMACIÓN';

    verdict.className =
      'verdict setup';

    $('#signalSubtitle').textContent =
      'Tendencia y nivel alineados. Falta confirmación de precio en 5M.';

    plan.classList.add(
      'hidden'
    );

  } else {
    verdict.textContent =
      'NO TRADE';

    verdict.className =
      'verdict neutral';

    $('#signalSubtitle').textContent =
      'Sin alineación entre tendencia clara y soporte/resistencia.';

    plan.classList.add(
      'hidden'
    );
  }


  $('#checklist').innerHTML =
    (d.checklist || [])
      .map(c => `
        <div class="check ${c.pass ? 'pass' : ''}">
          <b>
            ${c.pass ? '✓' : '×'}
          </b>

          <span>
            ${escapeHtml(c.label)}
          </span>
        </div>
      `)
      .join('');
}


/* =========================
   PAPER TRADING
   ========================= */

async function refreshPaper() {
  try {
    const r = await fetch(
      `/api/paper?t=${Date.now()}`,
      {
        cache: 'no-store'
      }
    );

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        `HTTP ${r.status}`
      );
    }

    renderPaper(data);

  } catch (err) {
    console.error(
      'Paper journal:',
      err
    );

    $('#journal').innerHTML =
      `
        <div class="empty">
          No se pudieron cargar
          las operaciones abiertas.
        </div>
      `;

    $('#historyJournal').innerHTML =
      `
        <div class="empty">
          No se pudo cargar
          el historial.
        </div>
      `;
  }
}


/* =========================
   ESTADÍSTICAS
   ========================= */

function renderStats(
  stats,
  totalFallback
) {
  $('#statTrades').textContent =
    stats.totalSignals ??
    totalFallback;

  $('#statWinRate').textContent =
    stats.winRatePct != null &&
    Number.isFinite(
      Number(
        stats.winRatePct
      )
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
    stats.expectancyR != null &&
    Number.isFinite(
      Number(
        stats.expectancyR
      )
    )
      ? `${signed(stats.expectancyR, 2)}R/trade`
      : '—';
}


/* =========================
   TARJETA DE OPERACIÓN
   ========================= */

function createTradeCard(t) {
  const div =
    document.createElement(
      'article'
    );

  div.className =
    'trade';

  const result =
    String(
      t.result || 'OPEN'
    ).toUpperCase();

  let resultText =
    'OPEN';

  let rText =
    '0R';

  let rClass =
    '';

  if (result === 'WIN') {
    resultText =
      'WIN';

    rText =
      Number.isFinite(
        Number(t.r)
      )
        ? `${signed(t.r, 0)}R`
        : '+2R';

    rClass =
      'trend-bull';
  }

  if (result === 'LOSS') {
    resultText =
      'LOSS';

    rText =
      Number.isFinite(
        Number(t.r)
      )
        ? `${signed(t.r, 0)}R`
        : '-1R';

    rClass =
      'trend-bear';
  }

  if (
    result === 'AMBIGUOUS'
  ) {
    resultText =
      'AMBIGUO';

    rText =
      '—';
  }


  const opened =
    localDate(
      t.candleTime
    );

  const closed =
    t.closedAt
      ? localDate(
          t.closedAt
        )
      : null;


  div.innerHTML = `
    <div class="trade-top">

      <div>

        <div class="trade-side ${String(t.side || '').toLowerCase()}">
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
      <b>
        ${escapeHtml(t.trend15m || '—')}
      </b>

      · Estructura:
      <b>
        ${escapeHtml(t.structure || '—')}
      </b>

      · Checklist:
      <b>
        ${escapeHtml(t.confluence || '—')}
      </b>

      ${
        t.riskPips != null
          ? `
            <br>
            Riesgo técnico:
            <b>${t.riskPips} pips</b>
          `
          : ''
      }

      ${
        closed
          ? `
            <br>
            Cerrada automáticamente:
            <b>${closed}</b>
          `
          : `
            <br>
            Estado:
            <b>esperando TP o SL</b>
          `
      }

    </div>
  `;

  return div;
}


/* =========================
   SEPARAR OPEN / HISTORIAL
   ========================= */

function renderPaper(data) {
  const stats =
    data.stats || {};

  const list =
    Array.isArray(
      data.trades
    )
      ? data.trades
      : [];


  renderStats(
    stats,
    list.length
  );


  const openTrades =
    list.filter(
      t =>
        String(
          t.result || 'OPEN'
        ).toUpperCase() ===
        'OPEN'
    );


  const closedTrades =
    list
      .filter(
        t =>
          String(
            t.result || 'OPEN'
          ).toUpperCase() !==
          'OPEN'
      )
      .sort(
        (a, b) =>
          new Date(
            b.closedAt ||
            b.candleTime
          ) -
          new Date(
            a.closedAt ||
            a.candleTime
          )
      );


  renderOpenTrades(
    openTrades
  );

  renderHistory(
    closedTrades
  );
}


/* =========================
   OPERACIONES ABIERTAS
   ========================= */

function renderOpenTrades(
  trades
) {
  const journal =
    $('#journal');

  journal.innerHTML =
    '';

  $('#emptyJournal')
    .classList.toggle(
      'hidden',
      trades.length > 0
    );

  for (
    const trade
    of trades
  ) {
    journal.appendChild(
      createTradeCard(
        trade
      )
    );
  }
}


/* =========================
   HISTORIAL
   ========================= */

function renderHistory(
  trades
) {
  const journal =
    $('#historyJournal');

  journal.innerHTML =
    '';

  $('#historyCount')
    .textContent =
      trades.length === 1
        ? '1 trade'
        : `${trades.length} trades`;

  $('#emptyHistory')
    .classList.toggle(
      'hidden',
      trades.length > 0
    );

  for (
    const trade
    of trades
  ) {
    journal.appendChild(
      createTradeCard(
        trade
      )
    );
  }
}


/* =========================
   BOTÓN ACTUALIZAR
   ========================= */

$('#refreshBtn').onclick =
  refresh;


/* =========================
   SERVICE WORKER
   ========================= */

if (
  'serviceWorker'
  in navigator
) {
  navigator
    .serviceWorker
    .register('/sw.js')
    .catch(
      () => {}
    );
}


/* =========================
   INICIO
   ========================= */

const savedTab =
  localStorage.getItem(
    'gbpjpy_active_tab'
  );

showTab(
  savedTab === 'history'
    ? 'history'
    : 'radar'
);

refresh();


/* =========================
   ACTUALIZACIÓN AUTOMÁTICA
   =========================
   El journal se refresca frecuentemente para que
   un cierre detectado por el monitor aparezca sin
   tener que recargar la página manualmente.
*/
setInterval(
  refresh,
  30 * 1000
);
