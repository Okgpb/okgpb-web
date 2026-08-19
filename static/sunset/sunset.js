(() => {
  const app = document.querySelector('[data-sunset-app]');
  if (!app) return;

  const API = 'https://sunset-service.b2897683301.workers.dev/api/v1/current?location=haifa';
  const $ = (name) => app.querySelector(`[data-${name}]`);

  const stateCopy = {
    SKIP: ['Low potential tonight', 'Probably skip it', 'Conditions are not lining up strongly enough to justify a dedicated sunset trip.'],
    WATCH: ['Worth watching', 'Keep an eye on it', 'There is enough potential to monitor the forecast, but not enough confidence to leave yet.'],
    GOOD: ['Promising conditions', 'Worth going', 'The current signal is strong enough to make tonight’s sunset a worthwhile plan.'],
    EXCELLENT: ['High-conviction signal', 'Go for sunset', 'Tonight has the combination of quality and supporting conditions Sunset Signal is looking for.']
  };

  const setText = (name, value) => {
    const node = $(name);
    if (node) node.textContent = value;
  };

  const fmtTime = (value) => {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(value));
    } catch { return '—'; }
  };

  const fmtDate = (value) => {
    if (!value) return 'Today';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'long'
      }).format(new Date(`${value}T12:00:00+03:00`));
    } catch { return value; }
  };

  const pct = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v))}%` : '—%';
  const bar = (name, value) => {
    const node = $(name);
    if (!node) return;
    const n = Math.max(0, Math.min(100, Number(value) || 0));
    requestAnimationFrame(() => { node.style.width = `${n}%`; });
  };

  const trendLabel = (value) => {
    const v = String(value || '').toUpperCase();
    if (v === 'IMPROVING') return 'Improving ↑';
    if (v === 'DEGRADING') return 'Degrading ↓';
    if (v === 'STABLE') return 'Stable →';
    return '—';
  };

  const freshnessLabel = (freshness) => {
    if (!freshness) return 'Freshness unavailable';
    if (freshness.stale) return 'Data marked stale';
    if (!freshness.updatedAt) return 'Latest provider data';
    const ageMin = Math.max(0, Math.round((Date.now() - new Date(freshness.updatedAt).getTime()) / 60000));
    if (!Number.isFinite(ageMin)) return 'Latest provider data';
    return ageMin < 2 ? 'Updated just now' : `Updated ${ageMin} min ago`;
  };

  const render = (data) => {
    const score = data?.quality?.score;
    const state = String(data?.recommendation?.state || 'WATCH').toUpperCase();
    const copy = stateCopy[state] || stateCopy.WATCH;

    app.dataset.state = state;
    setText('score', Number.isFinite(Number(score)) ? Math.round(Number(score)) : '—');
    setText('recommendation-kicker', copy[0]);
    setText('recommendation', copy[1]);
    setText('summary', copy[2]);
    setText('date', fmtDate(data?.date));
    setText('sunset-time', fmtTime(data?.event?.time));
    setText('direction', data?.event?.directionLabel ? `Direction ${data.event.directionLabel}` : 'Direction —');
    setText('confidence', data?.recommendation?.confidence ? String(data.recommendation.confidence).replaceAll('_', ' ') : '—');
    setText('freshness', freshnessLabel(data?.freshness));
    setText('trend', trendLabel(data?.recommendation?.trend));

    const low = data?.weather?.cloudLowPct;
    const mid = data?.weather?.cloudMidPct;
    const high = data?.weather?.cloudHighPct;
    setText('cloud-low', pct(low));
    setText('cloud-mid', pct(mid));
    setText('cloud-high', pct(high));
    bar('cloud-low-bar', low);
    bar('cloud-mid-bar', mid);
    bar('cloud-high-bar', high);

    const visibility = Number(data?.weather?.visibilityKm);
    setText('visibility', Number.isFinite(visibility) ? `${visibility.toFixed(0)} km` : 'Unavailable');

    const horizon = Array.isArray(data?.horizon) ? data.horizon : [];
    const horizonLow = horizon.map((p) => Number(p?.lowCloudPct)).filter(Number.isFinite);
    if (horizonLow.length) {
      const peak = Math.max(...horizonLow);
      setText('western-path', peak >= 70 ? 'High blockage risk' : peak >= 40 ? 'Some blockage risk' : 'Mostly open');
    } else {
      setText('western-path', 'Detailed path in V1.5');
    }

    const providerState = data?.quality?.score == null ? 'Weather-only fallback' : 'Sunsethue + weather';
    setText('provider-state', providerState);
    setText('status', 'Forecast connected');
    setText('updated', data?.freshness?.updatedAt ? `Updated ${new Date(data.freshness.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem' })}` : 'Latest available forecast');

    app.classList.add('is-ready');
  };

  const renderError = () => {
    setText('recommendation-kicker', 'Quiet fallback');
    setText('recommendation', 'Forecast unavailable');
    setText('summary', 'The live forecast could not be reached. The page remains usable and will recover on the next refresh.');
    setText('status', 'Live data temporarily unavailable');
    setText('provider-state', 'Connection failed');
    app.classList.add('is-ready');
  };

  fetch(API, { headers: { accept: 'application/json' }, cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(render)
    .catch(renderError);
})();
