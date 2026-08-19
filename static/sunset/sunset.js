(() => {
  "use strict";

  const API_BASE = "https://sunset-service.b2897683301.workers.dev/api/v1";
  const CACHE_KEY = "sunset-signal:last-current";
  const REFRESH_MS = 10 * 60 * 1000;
  let lastFetchAt = 0;
  let currentData = null;
  let historyData = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function text(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value ?? "—";
  }

  function number(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function pct(value) {
    const n = number(value);
    return n === null ? "—" : `${Math.round(n)}%`;
  }

  function timeZone(data = currentData) {
    return data?.location?.timezone || "Asia/Jerusalem";
  }

  function timeLabel(iso, data = currentData) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone(data),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function dateLabel(dateText, data = currentData) {
    if (!dateText) return "Today";
    const date = new Date(`${dateText}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateText;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone(data),
      weekday: "short",
      day: "numeric",
      month: "long"
    }).format(date);
  }

  function shortDate(dateText, data = currentData) {
    if (!dateText) return "—";
    const date = new Date(`${dateText}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone(data),
      weekday: "short",
      day: "numeric"
    }).format(date);
  }

  function relativeTime(iso) {
    if (!iso) return "Unknown";
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return "Unknown";
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  }

  function signed(value, suffix = "") {
    const n = number(value);
    if (n === null) return "—";
    const rounded = Math.round(n * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
  }

  function fetchJson(url) {
    return fetch(url, { headers: { accept: "application/json" }, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function showToast(message) {
    const toast = $("#status-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function recommendationCopy(state) {
    return {
      SKIP: ["Probably skip the trip.", "Conditions do not look strong enough to justify a dedicated sunset outing."],
      WATCH: ["Keep an eye on it.", "There is some potential, but the forecast is not convincing enough yet."],
      GOOD: ["Worth planning for.", "Tonight has enough promise to make a sunset stop worthwhile."],
      EXCELLENT: ["Make time for this one.", "The forecast is strong enough to prioritize the sunset window." ]
    }[state] || ["Forecast still forming.", "Some of tonight’s evidence is not available yet."];
  }

  function renderState(state) {
    const node = $("[data-state]");
    if (!node) return;
    node.className = `state state--${state || "loading"}`;
    node.textContent = state || "Unknown";
  }

  function renderCloud(data) {
    const weather = data.weather || {};
    const layers = [
      ["high", weather.cloudHighPct],
      ["mid", weather.cloudMidPct],
      ["low", weather.cloudLowPct]
    ];
    layers.forEach(([name, value]) => {
      text(`[data-cloud-${name}]`, pct(value));
      const bar = $(`[data-cloud-${name}-bar]`);
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, number(value) ?? 0))}%`;
    });

    const low = number(weather.cloudLowPct);
    const mid = number(weather.cloudMidPct);
    const high = number(weather.cloudHighPct);
    let summary = "Partial data";
    if (low !== null && mid !== null && high !== null) {
      if (low >= 55) summary = "Low cloud heavy";
      else if (mid >= 35 || high >= 35) summary = "Elevated canvas present";
      else if (low <= 20) summary = "Mostly clear layers";
      else summary = "Mixed layers";
    }
    text("[data-cloud-summary]", summary);
  }

  function evidenceItem(kind, title, detail, value) {
    return `<div class="evidence-item evidence-item--${kind}">
      <span class="evidence-sign">${kind === "positive" ? "+" : kind === "negative" ? "−" : "·"}</span>
      <div class="evidence-copy"><strong>${title}</strong><span>${detail}</span></div>
      <span class="evidence-value">${value}</span>
    </div>`;
  }

  function renderWhy(data) {
    const weather = data.weather || {};
    const items = [];
    const low = number(weather.cloudLowPct);
    const mid = number(weather.cloudMidPct);
    const high = number(weather.cloudHighPct);
    const visibility = number(weather.visibilityKm);

    if (low !== null) {
      if (low >= 50) items.push(evidenceItem("negative", "Local low cloud is substantial", "Low cloud can obstruct direct sunset light near the observer.", pct(low)));
      else if (low <= 20) items.push(evidenceItem("positive", "Local low cloud is limited", "The nearby lower atmosphere is relatively open toward sunset time.", pct(low)));
      else items.push(evidenceItem("neutral", "Local low cloud is mixed", "Some lower-cloud obstruction is present near event time.", pct(low)));
    }

    if (mid !== null || high !== null) {
      if ((mid ?? 0) < 15 && (high ?? 0) < 15) {
        items.push(evidenceItem("negative", "Little elevated cloud canvas", "There is limited mid/high cloud available to catch late sunlight.", `${pct(mid)} · ${pct(high)}`));
      } else if ((mid ?? 0) >= 35 || (high ?? 0) >= 35) {
        items.push(evidenceItem("positive", "Elevated cloud canvas is present", "Mid or high cloud may provide surfaces for color away from the horizon.", `${pct(mid)} · ${pct(high)}`));
      } else {
        items.push(evidenceItem("neutral", "Modest elevated cloud", "Some color-catching cloud is present, but not in large amounts.", `${pct(mid)} · ${pct(high)}`));
      }
    }

    if (visibility !== null) {
      if (visibility >= 25) items.push(evidenceItem("positive", "Long visibility", "Clearer air helps preserve horizon definition and distant color structure.", `${Math.round(visibility)} km`));
      else if (visibility < 10) items.push(evidenceItem("negative", "Limited visibility", "Haze or moisture may reduce distant contrast.", `${Math.round(visibility)} km`));
      else items.push(evidenceItem("neutral", "Moderate visibility", "Air clarity is usable but not exceptional.", `${Math.round(visibility)} km`));
    }

    const far = (data.horizon || []).find((sample) => sample.distanceKm === 200);
    if (number(far?.cloudLowPct) !== null) {
      const farLow = number(far.cloudLowPct);
      items.push(evidenceItem(
        farLow >= 55 ? "negative" : farLow <= 20 ? "positive" : "neutral",
        "The distant light path is visible",
        "The 200 km sample checks cloud where incoming sunset light may travel before reaching Haifa.",
        pct(farLow)
      ));
    }

    const container = $("#why-list");
    if (container) container.innerHTML = (items.length ? items : [evidenceItem("neutral", "Evidence is incomplete", "Weather context is still being assembled.", "—")]).slice(0, 4).join("");
  }

  function matrixCell(layer, value) {
    const n = number(value);
    const display = n === null ? "—" : `${Math.round(n)}%`;
    return `<div class="matrix-cell matrix-cell--${layer}" style="--v:${n ?? 0}" role="cell"><strong>${display}</strong><span>${n === null ? "no data" : "cloud"}</span></div>`;
  }

  function renderHorizon(data) {
    text("[data-horizon-direction]", `${data.event?.directionLabel || "—"}${number(data.event?.azimuthDeg) !== null ? ` · ${Math.round(data.event.azimuthDeg)}°` : ""}`);
    const matrix = $("#horizon-matrix");
    if (!matrix) return;

    const samples = data.horizon || [];
    const local = {
      distanceKm: 0,
      cloudLowPct: data.weather?.cloudLowPct ?? null,
      cloudMidPct: data.weather?.cloudMidPct ?? null,
      cloudHighPct: data.weather?.cloudHighPct ?? null
    };
    const ordered = [local, ...[25, 50, 100, 200].map((distanceKm) => samples.find((s) => s.distanceKm === distanceKm) || { distanceKm, cloudLowPct: null, cloudMidPct: null, cloudHighPct: null })];
    const headers = ["Here", "25", "50", "100", "200"];

    matrix.innerHTML = `<div class="matrix-corner"></div>${headers.map((label, index) => `<div class="matrix-distance"><strong>${label}</strong><span>${index === 0 ? "0 km" : "km"}</span></div>`).join("")}
      <div class="matrix-layer matrix-layer--high"><strong>High</strong><span>8 km+</span></div>${ordered.map((s) => matrixCell("high", s.cloudHighPct)).join("")}
      <div class="matrix-layer matrix-layer--mid"><strong>Mid</strong><span>3–8 km</span></div>${ordered.map((s) => matrixCell("mid", s.cloudMidPct)).join("")}
      <div class="matrix-layer matrix-layer--low"><strong>Low</strong><span>0–3 km</span></div>${ordered.map((s) => matrixCell("low", s.cloudLowPct)).join("")}`;

    const insight = $("#horizon-insight p");
    if (!insight) return;
    const localLow = number(local.cloudLowPct);
    const farLow = number(ordered[4]?.cloudLowPct);
    const highValues = ordered.map((s) => number(s.cloudHighPct)).filter((v) => v !== null);
    const midValues = ordered.map((s) => number(s.cloudMidPct)).filter((v) => v !== null);

    const phrases = [];
    if (localLow !== null && farLow !== null) {
      const verb = farLow > localLow + 5 ? "rises" : farLow < localLow - 5 ? "falls" : "stays similar";
      phrases.push(`Low cloud ${verb} from ${Math.round(localLow)}% over Haifa to ${Math.round(farLow)}% at 200 km.`);
    }
    if (highValues.length >= 3) {
      phrases.push(`High cloud spans ${Math.round(Math.min(...highValues))}–${Math.round(Math.max(...highValues))}% across the sampled light path.`);
    } else if (midValues.length >= 3) {
      phrases.push(`Mid cloud spans ${Math.round(Math.min(...midValues))}–${Math.round(Math.max(...midValues))}% across the sampled light path.`);
    }
    insight.textContent = phrases.length ? phrases.join(" ") : "Layered 25/50/100/200 km evidence will appear when a sunset azimuth and horizon samples are available.";
  }

  function renderSolar(data) {
    text("[data-direction]", `${data.event?.directionLabel || "—"}${number(data.event?.azimuthDeg) !== null ? ` ${Math.round(data.event.azimuthDeg)}°` : ""}`);
    text("[data-golden]", data.event?.goldenHourStart ? `${timeLabel(data.event.goldenHourStart, data)} – ${timeLabel(data.event.goldenHourEnd || data.event.time, data)}` : "—");
    text("[data-sunset]", timeLabel(data.event?.time, data));
    text("[data-sunset-compact]", timeLabel(data.event?.time, data));

    const sunsetMs = data.event?.time ? new Date(data.event.time).getTime() : NaN;
    const goldenMs = data.event?.goldenHourStart ? new Date(data.event.goldenHourStart).getTime() : NaN;
    const now = Date.now();
    let progress = .5;
    let remaining = "Timing unavailable";
    if (Number.isFinite(sunsetMs)) {
      const start = Number.isFinite(goldenMs) ? goldenMs : sunsetMs - 60 * 60 * 1000;
      progress = Math.max(0, Math.min(1, (now - start) / Math.max(1, sunsetMs - start)));
      const minutes = Math.round((sunsetMs - now) / 60000);
      if (minutes > 0) remaining = minutes <= 60 ? `${minutes} min to sunset` : `${Math.floor(minutes / 60)}h ${minutes % 60}m to sunset`;
      else if (minutes > -90) remaining = `Sunset passed ${Math.abs(minutes)}m ago`;
      else remaining = "Tonight’s sunset has passed";
    }
    text("[data-remaining]", remaining);

    const path = $("#sun-path");
    const dot = $("#sun-dot");
    const halo = $("#sun-halo");
    if (path && dot && halo && typeof path.getTotalLength === "function") {
      const point = path.getPointAtLength(path.getTotalLength() * progress);
      dot.setAttribute("cx", point.x); dot.setAttribute("cy", point.y);
      halo.setAttribute("cx", point.x); halo.setAttribute("cy", point.y);
    }
  }

  function renderWindow(data) {
    const golden = data.event?.goldenHourStart ? new Date(data.event.goldenHourStart).getTime() : NaN;
    const sunset = data.event?.time ? new Date(data.event.time).getTime() : NaN;
    const blueEnd = data.event?.blueHourEnd ? new Date(data.event.blueHourEnd).getTime() : NaN;
    text("[data-window-golden]", timeLabel(data.event?.goldenHourStart, data));
    text("[data-window-sunset]", timeLabel(data.event?.time, data));
    text("[data-window-blue]", timeLabel(data.event?.blueHourEnd, data));

    if (!Number.isFinite(golden) || !Number.isFinite(sunset)) {
      text("[data-window-status]", "Partial timing");
      text("[data-window-advice]", "Golden-hour timing is not available from the current provider snapshot.");
      return;
    }

    const end = Number.isFinite(blueEnd) && blueEnd > sunset ? blueEnd : sunset;
    const span = Math.max(1, end - golden);
    const now = Date.now();
    const progress = Math.max(0, Math.min(1, (now - golden) / span));
    const sunsetPos = Math.max(0, Math.min(1, (sunset - golden) / span));
    const fill = $("[data-window-fill]");
    const marker = $("[data-window-now]");
    const sunsetMarker = $("[data-window-sunset-marker]");
    const blueMarker = $("[data-window-blue-marker]");
    if (fill) fill.style.width = `${progress * 100}%`;
    if (marker) marker.style.left = `${progress * 100}%`;
    if (sunsetMarker) sunsetMarker.style.left = `${sunsetPos * 100}%`;
    if (blueMarker) blueMarker.style.display = Number.isFinite(blueEnd) ? "block" : "none";

    if (now < golden) {
      text("[data-window-status]", "Ahead of window");
      text("[data-window-advice]", `Golden hour begins at ${timeLabel(data.event.goldenHourStart, data)}.`);
    } else if (now <= sunset) {
      text("[data-window-status]", "Golden hour active");
      text("[data-window-advice]", `The primary sunset window is active now; sunset is at ${timeLabel(data.event.time, data)}.`);
    } else if (Number.isFinite(blueEnd) && now <= blueEnd) {
      text("[data-window-status]", "Blue hour");
      text("[data-window-advice]", `Sunset has passed, but the post-sunset blue-hour window continues until ${timeLabel(data.event.blueHourEnd, data)}.`);
    } else {
      text("[data-window-status]", "Window passed");
      text("[data-window-advice]", "Tonight’s main sunset viewing window has passed.");
    }
  }

  function renderConfidence(data) {
    const confidence = data.recommendation?.confidence || "LOW";
    text("[data-confidence]", confidence);
    text("[data-confidence-big]", confidence);
    text("[data-source-sunsethue]", relativeTime(data.freshness?.sunsethueAt));
    text("[data-source-weather]", relativeTime(data.freshness?.weatherAt));
    text("[data-source-page]", "Now");

    const checks = [];
    checks.push([!data.freshness?.stale, data.freshness?.stale ? "Sunsethue forecast is stale" : "Sunsethue forecast is within the freshness window"]);
    checks.push([Boolean(data.freshness?.weatherAt), data.freshness?.weatherAt ? "Open-Meteo weather context is available" : "Open-Meteo weather context is unavailable"]);
    const completeCloud = [data.weather?.cloudLowPct, data.weather?.cloudMidPct, data.weather?.cloudHighPct].every((v) => number(v) !== null);
    checks.push([completeCloud, completeCloud ? "All three local cloud layers are present" : "Some local cloud layers are missing"]);
    checks.push([(data.horizon || []).length >= 4, (data.horizon || []).length >= 4 ? "Layered western-horizon samples are present" : "Layered western-horizon samples are not available yet"]);
    const container = $("#confidence-checks");
    if (container) container.innerHTML = checks.map(([ok, label]) => `<div class="confidence-check ${ok ? "" : "is-neutral"}"><span class="confidence-check__mark">${ok ? "✓" : "·"}</span><span>${label}</span></div>`).join("");
  }

  function renderCurrent(data, cached = false) {
    currentData = data;
    document.body.classList.remove("is-loading");
    document.body.classList.toggle("is-error", cached);
    text("[data-location]", `${data.location?.name || "Haifa"}, Israel`);
    text("[data-date]", dateLabel(data.date, data));
    text("[data-score]", number(data.quality?.score) === null ? "—" : Math.round(data.quality.score));
    renderState(data.recommendation?.state);
    const [headline, summary] = recommendationCopy(data.recommendation?.state);
    text("[data-headline]", headline);
    text("[data-summary]", summary);
    text("[data-trend]", trendLabel(data.recommendation?.trend));
    text("[data-updated]", relativeTime(data.freshness?.updatedAt));
    text("[data-live-label]", cached ? "Cached forecast" : data.freshness?.stale ? "Stale forecast" : "Live forecast");
    renderSolar(data);
    renderCloud(data);
    renderHorizon(data);
    renderWhy(data);
    renderWindow(data);
    renderConfidence(data);
  }

  function trendLabel(trend) {
    return { IMPROVING: "Improving ↑", DEGRADING: "Degrading ↓", STABLE: "Stable →", UNKNOWN: "Not enough data" }[trend] || "—";
  }

  function renderNext(data) {
    const container = $("#next-days");
    if (!container) return;
    const days = Array.isArray(data?.days) ? data.days : [];
    if (!days.length) {
      container.innerHTML = `<div class="next-day"><div class="next-day__date"><strong>No future data</strong><span>Forecast unavailable</span></div><div class="next-day__score">—</div></div>`;
      return;
    }
    container.innerHTML = days.map((day, index) => `<div class="next-day">
      <div class="next-day__date"><strong>${index === 0 ? "Today" : shortDate(day.date, currentData)}</strong><span>${timeLabel(day.sunsetTime, currentData)} sunset</span></div>
      <div class="next-day__score">${number(day.qualityScore) === null ? "—" : Math.round(day.qualityScore)}</div>
      <div class="next-day__state" data-state="${day.recommendation || ""}">${day.recommendation || "UNKNOWN"}</div>
    </div>`).join("");
  }

  function qualityPoints(history) {
    return (history?.snapshots || []).filter((snapshot) => number(snapshot.qualityScore) !== null);
  }

  function renderJourney(history) {
    historyData = history;
    const points = qualityPoints(history);
    const wrap = $(".chart-wrap");
    const line = $("#journey-line");
    const area = $("#journey-area");
    const pointGroup = $("#journey-points");
    if (!wrap || !line || !pointGroup) return;

    if (points.length < 2) {
      wrap.classList.remove("has-data");
      text("[data-journey-first]", points.length ? Math.round(points[0].qualityScore) : "—");
      text("[data-journey-best]", points.length ? Math.round(points[0].qualityScore) : "—");
      text("[data-journey-now]", points.length ? Math.round(points[0].qualityScore) : "—");
      return;
    }

    wrap.classList.add("has-data");
    const x0 = 46, x1 = 730, yTop = 40, yBottom = 212;
    const coords = points.map((point, index) => {
      const x = x0 + (index / (points.length - 1)) * (x1 - x0);
      const y = yBottom - (point.qualityScore / 100) * (yBottom - yTop);
      return { x, y, point };
    });
    const d = coords.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    line.setAttribute("d", d);
    line.style.animation = "none";
    requestAnimationFrame(() => { line.style.animation = ""; });
    if (area) {
      area.setAttribute("d", `${d} L${coords[coords.length - 1].x.toFixed(1)} ${yBottom} L${coords[0].x.toFixed(1)} ${yBottom} Z`);
      area.style.fill = "rgba(88, 215, 255, .07)";
    }
    pointGroup.innerHTML = coords.map((p) => `<circle class="journey-point" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"><title>${timeLabel(p.point.observedAt, currentData)} · ${Math.round(p.point.qualityScore)}</title></circle>`).join("");

    const first = points[0].qualityScore;
    const last = points[points.length - 1].qualityScore;
    const delta = last - first;
    const deltaNode = $("[data-journey-delta]");
    if (deltaNode) {
      deltaNode.textContent = `${signed(delta, " pts")} today`;
      deltaNode.className = `journey-delta ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`;
    }
    text("[data-journey-first]", Math.round(first));
    text("[data-journey-best]", Math.round(Math.max(...points.map((p) => p.qualityScore))));
    text("[data-journey-now]", Math.round(last));
  }

  function difference(current, previous) {
    const a = number(current), b = number(previous);
    return a === null || b === null ? null : a - b;
  }

  function horizonAt(snapshot, distanceKm) {
    return (snapshot?.horizon || []).find((sample) => sample.distanceKm === distanceKm) || null;
  }

  function renderChanges(history) {
    const container = $("#change-list");
    const note = $("[data-change-note]");
    if (!container) return;
    const snapshots = history?.snapshots || [];
    if (snapshots.length < 2) {
      container.innerHTML = `<div class="change-item"><span>Waiting for another snapshot</span><strong>—</strong></div>`;
      if (note) note.textContent = "Comparisons appear once two snapshots are available.";
      return;
    }

    const previous = snapshots[snapshots.length - 2];
    const latest = snapshots[snapshots.length - 1];
    const fields = [
      { label: "Quality", delta: difference(latest.qualityScore, previous.qualityScore), suffix: " pts", kind: "score" },
      { label: "Low cloud", delta: difference(latest.weather?.cloudLowPct, previous.weather?.cloudLowPct), suffix: " pp", kind: "low" },
      { label: "Mid cloud", delta: difference(latest.weather?.cloudMidPct, previous.weather?.cloudMidPct), suffix: " pp", kind: "neutral" },
      { label: "High cloud", delta: difference(latest.weather?.cloudHighPct, previous.weather?.cloudHighPct), suffix: " pp", kind: "neutral" },
      { label: "200 km low cloud", delta: difference(horizonAt(latest, 200)?.cloudLowPct, horizonAt(previous, 200)?.cloudLowPct), suffix: " pp", kind: "low" }
    ].filter((field) => field.delta !== null);

    container.innerHTML = (fields.length ? fields : [{ label: "No comparable weather changes", delta: 0, suffix: "", kind: "neutral" }]).slice(0, 5).map((field) => {
      let directionClass = "";
      if (field.delta > 0) directionClass = "up";
      if (field.delta < 0) directionClass = "down";
      return `<div class="change-item ${field.kind === "score" ? "change-item--score" : ""}"><span>${field.label}</span><strong class="${field.kind === "neutral" ? "" : directionClass}">${signed(field.delta, field.suffix)}</strong></div>`;
    }).join("");
    if (note) note.textContent = `Previous snapshot ${relativeTime(previous.observedAt)}.`;
  }

  function initReveals() {
    const nodes = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .08, rootMargin: "0px 0px -5% 0px" });
    nodes.forEach((node) => observer.observe(node));
  }

  async function refreshData({ silent = false } = {}) {
    lastFetchAt = Date.now();
    let current;
    try {
      current = await fetchJson(`${API_BASE}/current?location=haifa`);
      renderCurrent(current, false);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch {}
    } catch (error) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch {}
      if (cached) {
        current = cached;
        renderCurrent(cached, true);
        if (!silent) showToast("Live service unavailable — showing the last known forecast.");
      } else {
        document.body.classList.remove("is-loading");
        document.body.classList.add("is-error");
        text("[data-live-label]", "Forecast unavailable");
        text("[data-headline]", "Forecast temporarily unavailable.");
        text("[data-summary]", "The atmospheric shell is ready, but the live service could not be reached.");
        if (!silent) showToast("Could not load the live forecast.");
        return;
      }
    }

    const [forecastResult, historyResult] = await Promise.allSettled([
      fetchJson(`${API_BASE}/forecast?location=haifa&days=3`),
      fetchJson(`${API_BASE}/history?location=haifa&date=${encodeURIComponent(current.date)}`)
    ]);

    if (forecastResult.status === "fulfilled") renderNext(forecastResult.value);
    if (historyResult.status === "fulfilled") {
      renderJourney(historyResult.value);
      renderChanges(historyResult.value);
    } else {
      renderJourney(null);
      renderChanges(null);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initReveals();
    refreshData();
    window.setInterval(() => {
      if (!document.hidden) refreshData({ silent: true });
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastFetchAt > 5 * 60 * 1000) refreshData({ silent: true });
    });
  });
})();
