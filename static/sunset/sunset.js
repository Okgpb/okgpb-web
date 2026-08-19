(() => {
  "use strict";

  const API_BASE = "https://sunset-service.b2897683301.workers.dev/api/v1";
  const LOCATION = "haifa";
  const CACHE_PREFIX = "sunset-signal:v3:";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    forecast: null,
    days: [],
    selectedIndex: 0,
    day: null,
    history: null,
    lightPath: null,
    sceneAnimation: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const pct = (value) => finite(value) ? `${Math.round(value)}%` : "—";
  const numberOr = (value, fallback = 0) => finite(value) ? value : fallback;

  function api(path) {
    return `${API_BASE}${path}`;
  }

  async function getJson(path) {
    const response = await fetch(api(path), { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.code || `HTTP_${response.status}`);
    return body;
  }

  function dateLabel(date, index) {
    if (index === 0) return "Today";
    if (index === 1) return "Tomorrow";
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  function fullDateLabel(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
  }

  function formatTime(iso, timeZone = state.day?.location?.timezone || "Asia/Jerusalem") {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  }

  function formatAge(iso) {
    if (!iso) return "Unavailable";
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return "Unavailable";
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
  }

  function durationLabel(ms) {
    if (!Number.isFinite(ms)) return "";
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function storeDay(day) {
    try { localStorage.setItem(`${CACHE_PREFIX}${day.date}`, JSON.stringify(day)); } catch {}
  }

  function readCachedDay(date) {
    try {
      const value = localStorage.getItem(`${CACHE_PREFIX}${date}`);
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  }

  function stateHeadline(recommendation) {
    switch (recommendation) {
      case "EXCELLENT": return ["Go for it.", "Conditions line up for a high-potential sunset."];
      case "GOOD": return ["Worth the trip.", "The evening has enough supporting evidence to justify going."];
      case "WATCH": return ["Keep an eye on it.", "There is potential, but the atmosphere still has meaningful trade-offs."];
      case "SKIP": return ["Probably skip the trip.", "Conditions do not look strong enough to justify a dedicated sunset outing."];
      default: return ["Forecast unavailable.", "The latest sunset decision could not be loaded."];
    }
  }

  function recommendationClass(value) {
    return value ? `state--${value.toLowerCase()}` : "state--loading";
  }

  function titleCase(value) {
    return String(value || "").toLowerCase().replace(/(^|\s|_)([a-z])/g, (_, prefix, letter) => `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`);
  }

  function renderDayNavigation() {
    $$(".day-tab").forEach((tab, index) => {
      const item = state.days[index];
      tab.disabled = !item;
      tab.classList.toggle("is-active", index === state.selectedIndex);
      const label = $("span", tab);
      const score = $("strong", tab);
      if (label) label.textContent = item ? dateLabel(item.date, index) : index === 0 ? "Today" : index === 1 ? "Tomorrow" : "+2 days";
      if (score) score.textContent = item && finite(item.qualityScore) ? String(Math.round(item.qualityScore)) : "—";
    });
  }

  function renderHero() {
    const day = state.day;
    if (!day) return;
    setText("[data-location]", `${day.location?.name || "Haifa"}, Israel`);
    setText("[data-date]", fullDateLabel(day.date));
    setText("[data-score]", finite(day.quality?.score) ? Math.round(day.quality.score) : "—");
    const recommendation = day.recommendation?.state || null;
    const stateEl = $("[data-state]");
    if (stateEl) {
      stateEl.className = `state ${recommendationClass(recommendation)}`;
      stateEl.textContent = recommendation || "Unavailable";
    }
    const [headline, summary] = stateHeadline(recommendation);
    setText("[data-headline]", headline);
    setText("[data-summary]", summary);
    setText("[data-direction]", `${day.event?.directionLabel || "West"} ${finite(day.event?.azimuthDeg) ? `${Math.round(day.event.azimuthDeg)}°` : ""}`.trim());
    setText("[data-sunset-compact]", formatTime(day.event?.time));
    setText("[data-confidence]", day.recommendation?.confidence || "LOW");
    setText("[data-trend]", titleCase(day.recommendation?.trend || "UNKNOWN"));
    setText("[data-updated]", formatAge(day.freshness?.updatedAt));
    renderHeroTimeline();
  }

  function isSelectedToday() { return state.selectedIndex === 0; }

  function eventWindow() {
    const event = state.day?.event || {};
    const sunset = event.time ? Date.parse(event.time) : NaN;
    let start = event.goldenHourStart ? Date.parse(event.goldenHourStart) : NaN;
    let end = event.lastUsefulLight ? Date.parse(event.lastUsefulLight) : event.blueHourEnd ? Date.parse(event.blueHourEnd) : NaN;
    if (!Number.isFinite(start) && Number.isFinite(sunset)) start = sunset - 45 * 60000;
    if (!Number.isFinite(end) && Number.isFinite(sunset)) end = sunset + 45 * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start, sunset, end };
  }

  function renderHeroTimeline() {
    const day = state.day;
    const event = day?.event || {};
    const windowInfo = eventWindow();
    const now = Date.now();
    const blue = event.blueHourStart || event.blueHourEnd;
    [
      ["[data-axis-golden]", event.goldenHourStart],
      ["[data-axis-sunset]", event.time],
      ["[data-axis-blue]", blue],
      ["[data-axis-last]", event.lastUsefulLight || event.blueHourEnd]
    ].forEach(([selector, iso]) => {
      const el = $(selector);
      const strong = el && $("strong", el);
      if (strong) strong.textContent = formatTime(iso);
    });
    if (!windowInfo) { setText("[data-remaining]", "Timing unavailable"); return; }

    let displayTime = Number.isFinite(windowInfo.sunset) ? windowInfo.sunset : windowInfo.start;
    if (isSelectedToday()) displayTime = now;
    if (isSelectedToday()) {
      if (now < windowInfo.start) setText("[data-remaining]", `Golden hour in ${durationLabel(windowInfo.start - now)}`);
      else if (Number.isFinite(windowInfo.sunset) && now < windowInfo.sunset) setText("[data-remaining]", `Sunset in ${durationLabel(windowInfo.sunset - now)}`);
      else if (now <= windowInfo.end) setText("[data-remaining]", "Sunset passed · color window active");
      else setText("[data-remaining]", "Useful viewing window passed");
    } else {
      setText("[data-remaining]", `${dateLabel(day.date, state.selectedIndex)} · sunset ${formatTime(event.time)}`);
    }

    const progress = clamp((displayTime - windowInfo.start) / (windowInfo.end - windowInfo.start), 0, 1);
    const axisProgress = $("[data-axis-progress]");
    const axisNow = $("[data-axis-now]");
    if (axisProgress) axisProgress.style.width = `${progress * 100}%`;
    if (axisNow) { axisNow.style.left = `${progress * 100}%`; axisNow.style.opacity = isSelectedToday() ? "1" : "0"; }

    const altitude = sunPosition(new Date(displayTime), day.location?.latitude ?? 32.794, day.location?.longitude ?? 34.9896).altitude;
    const x = 24 + progress * 472;
    const y = clamp(148 - altitude * 8.2, 18, 176);
    ["#sun-dot", "#sun-halo"].forEach((selector) => {
      const el = $(selector);
      if (el) { el.setAttribute("cx", x.toFixed(1)); el.setAttribute("cy", y.toFixed(1)); }
    });
    const nowLine = $("#solar-now-line");
    if (nowLine) {
      nowLine.setAttribute("x1", x.toFixed(1)); nowLine.setAttribute("x2", x.toFixed(1)); nowLine.style.opacity = isSelectedToday() ? "1" : "0";
    }
  }

  function sunPosition(date, latitude, longitude) {
    const rad = Math.PI / 180;
    const julian = date.getTime() / 86400000 - 0.5 + 2440588;
    const d = julian - 2451545;
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const e = rad * 23.4397;
    const dec = Math.asin(Math.sin(L) * Math.sin(e));
    const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const sidereal = rad * (280.16 + 360.9856235 * d) - rad * longitude;
    const H = sidereal - ra;
    const phi = rad * latitude;
    const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { altitude: altitude / rad, azimuth: ((azimuth / rad + 180) % 360 + 360) % 360 };
  }

  function horizonValues(day) {
    const local = { distanceKm: 0, cloudLowPct: day.weather?.cloudLowPct ?? null, cloudMidPct: day.weather?.cloudMidPct ?? null, cloudHighPct: day.weather?.cloudHighPct ?? null };
    return [local, ...(Array.isArray(day.horizon) ? day.horizon : [])].sort((a, b) => a.distanceKm - b.distanceKm);
  }

  function sceneClassification(day) {
    const samples = horizonValues(day);
    const local = samples.find((sample) => sample.distanceKm === 0) || {};
    const distant = samples.filter((sample) => sample.distanceKm > 0);
    const localLow = numberOr(local.cloudLowPct);
    const pathLow = distant.map((sample) => numberOr(sample.cloudLowPct));
    const pathLowAvg = pathLow.length ? pathLow.reduce((a, b) => a + b, 0) / pathLow.length : localLow;
    const pathLowMax = pathLow.length ? Math.max(...pathLow) : localLow;
    const elevatedValues = samples.flatMap((sample) => [numberOr(sample.cloudMidPct), numberOr(sample.cloudHighPct)]);
    const elevatedMax = elevatedValues.length ? Math.max(...elevatedValues) : 0;
    const visibility = numberOr(day.weather?.visibilityKm);
    const score = numberOr(day.quality?.score, 50);

    let id = "PATCHY";
    if (localLow >= 85 && pathLowAvg >= 70 && score < 40) id = "OVERCAST";
    else if (pathLowMax >= 82 && pathLowAvg >= 58) id = "BLOCKED";
    else if (elevatedMax >= 55 && localLow < 60 && pathLowAvg < 62) id = "DRAMATIC";
    else if (elevatedMax >= 28) id = "POST_COLOR";
    else if (localLow < 34 && pathLowAvg < 34) id = "CLEAN";
    else if (localLow < 45 && pathLowMax < 48 && elevatedMax < 18) id = "DISC_LIMITED";

    const templates = {
      OVERCAST: { badge: "Clouded out", title: "Little or no visible sunset.", summary: "Low cloud is extensive enough that both the sun disc and most useful color are likely to be muted.", factors: [`Local low cloud is ${pct(localLow)}.`, `Average distant low cloud is ${pct(pathLowAvg)}.`, elevatedMax < 25 ? "There is little elevated cloud canvas to rescue the scene." : "Some elevated cloud exists, but low cloud remains the dominant limitation."] },
      BLOCKED: { badge: "Blocked horizon", title: "The final drop may disappear behind distant low cloud.", summary: "The sky may open above the horizon, but the western light path contains a strong low-cloud obstruction risk.", factors: [`The strongest distant low-cloud sample is ${pct(pathLowMax)}.`, `Local low cloud is ${pct(localLow)}.`, elevatedMax >= 25 ? `Elevated cloud still reaches ${pct(elevatedMax)}, so some afterglow remains possible.` : "Elevated color-catching cloud is limited."] },
      PATCHY: { badge: "Patchy low cloud", title: "The sun may appear in gaps, with an uncertain final drop.", summary: "Low cloud is substantial but not fully closed. Expect an intermittent disc and a real chance of short clear openings near the horizon.", factors: [`Local low cloud is ${pct(localLow)} and the strongest distant sample is ${pct(pathLowMax)}.`, elevatedMax < 25 ? "Mid/high cloud is sparse, so dramatic color is less likely." : `Elevated cloud reaches ${pct(elevatedMax)} and may catch color through gaps.`, visibility > 20 ? `${Math.round(visibility)} km visibility keeps the open parts of the horizon relatively crisp.` : "Visibility is not especially long."] },
      DISC_LIMITED: { badge: "Visible disc · limited color", title: "A cleaner sun disc is more likely than a dramatic sky.", summary: "The direct light path is comparatively workable, but there is little mid/high cloud available to catch warm color.", factors: [`Distant low cloud stays below about ${pct(pathLowMax)}.`, `The strongest elevated cloud layer is only ${pct(elevatedMax)}.`, visibility > 20 ? `${Math.round(visibility)} km visibility favors a defined horizon.` : "Haze may soften horizon definition."] },
      CLEAN: { badge: "Clean horizon drop", title: "A clear, simple sunset is the leading scenario.", summary: "Low cloud is limited both locally and along the western path, improving the odds of following the disc down to the horizon.", factors: [`Local low cloud is ${pct(localLow)}.`, `Average distant low cloud is ${pct(pathLowAvg)}.`, elevatedMax < 25 ? "The scene may be clean rather than highly colorful." : `Some elevated canvas remains at ${pct(elevatedMax)}.`] },
      POST_COLOR: { badge: "Afterglow potential", title: "The best color may arrive after the sun goes down.", summary: "Elevated cloud offers a useful canvas even if the disc itself is partly interrupted by lower cloud.", factors: [`Elevated cloud reaches ${pct(elevatedMax)} along the sampled path.`, `Local low cloud is ${pct(localLow)}.`, "Stay through the post-sunset window: elevated layers can keep catching light after the disc is gone."] },
      DRAMATIC: { badge: "Layered dramatic", title: "This setup can support a layered, colorful sunset.", summary: "A workable low-cloud path and stronger mid/high cloud create the best combination for visible structure and post-sunset color.", factors: [`Elevated cloud reaches ${pct(elevatedMax)}.`, `Average distant low cloud is ${pct(pathLowAvg)}.`, visibility > 20 ? `${Math.round(visibility)} km visibility supports distant contrast.` : "Visibility is the main remaining limitation."] }
    };
    return { id, ...templates[id], metrics: { localLow, pathLowAvg, pathLowMax, elevatedMax, visibility } };
  }

  function renderScene() {
    const scene = sceneClassification(state.day);
    setText("[data-scene-badge]", scene.badge);
    setText("[data-scene-title]", scene.title);
    setText("[data-scene-summary]", scene.summary);
    const factors = $("#scene-factors");
    if (factors) factors.innerHTML = scene.factors.map((text) => `<div class="scene-factor"><i></i><span>${escapeHtml(text)}</span></div>`).join("");
    startSceneCanvas(scene);
  }

  function startSceneCanvas(scene) {
    const canvas = $("#scene-canvas");
    if (!canvas) return;
    if (state.sceneAnimation) cancelAnimationFrame(state.sceneAnimation);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const started = performance.now();
    const frame = (now) => {
      drawSceneCanvas(canvas, ctx, scene, reduceMotion ? 0 : (now - started) / 1000);
      if (!reduceMotion) state.sceneAnimation = requestAnimationFrame(frame);
    };
    frame(started);
  }

  function fitCanvas(canvas, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function drawCloudBand(ctx, width, y, coverage, color, drift, scale = 1) {
    if (coverage <= 1) return;
    const opacity = clamp(coverage / 100, 0.08, 0.72);
    const count = Math.max(2, Math.round(2 + coverage / 18));
    ctx.save();
    ctx.fillStyle = color.replace("ALPHA", (opacity * 0.82).toFixed(3));
    for (let index = 0; index < count; index += 1) {
      const x = ((index / count) * (width + 180) + drift * (index % 2 ? 1 : -0.7)) % (width + 180) - 90;
      const rx = (70 + (index % 3) * 24) * scale;
      const ry = (16 + (index % 2) * 9) * scale;
      ctx.beginPath(); ctx.ellipse(x, y + Math.sin(index * 1.8) * 11, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + rx * 0.35, y - ry * 0.45, rx * 0.66, ry * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawSceneCanvas(canvas, ctx, scene, seconds) {
    const { width, height } = fitCanvas(canvas, ctx);
    const palettes = { OVERCAST: ["#1c2736", "#404957", "#665e61"], BLOCKED: ["#10243f", "#563f51", "#de805d"], PATCHY: ["#0c2949", "#47415c", "#dd8767"], DISC_LIMITED: ["#0d2f57", "#5d5572", "#f2a06a"], CLEAN: ["#153b68", "#7e5d76", "#ffaf6c"], POST_COLOR: ["#152755", "#7a496d", "#f58a74"], DRAMATIC: ["#172a5d", "#8b4867", "#ff9c62"] };
    const palette = palettes[scene.id];
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette[0]); gradient.addColorStop(0.55, palette[1]); gradient.addColorStop(1, palette[2]);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const horizonY = height * 0.79;
    const glow = ctx.createRadialGradient(width * 0.73, horizonY * 0.83, 0, width * 0.73, horizonY * 0.83, width * 0.35);
    glow.addColorStop(0, "rgba(255,190,110,.36)"); glow.addColorStop(0.55, "rgba(255,121,92,.11)"); glow.addColorStop(1, "rgba(255,121,92,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    const m = scene.metrics;
    const drift = Math.sin(seconds * 0.07) * 24;
    drawCloudBand(ctx, width, height * 0.22, m.elevatedMax * 0.62, "rgba(188,154,255,ALPHA)", drift * 0.55, 0.72);
    drawCloudBand(ctx, width, height * 0.39, m.elevatedMax * 0.78, "rgba(174,154,224,ALPHA)", -drift * 0.72, 0.92);
    if (scene.id !== "OVERCAST") {
      let sunY = horizonY - height * 0.10;
      if (scene.id === "POST_COLOR") sunY = horizonY + height * 0.035;
      const sunX = width * 0.73;
      const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 56);
      halo.addColorStop(0, "rgba(255,252,220,.82)"); halo.addColorStop(0.18, "rgba(255,201,118,.52)"); halo.addColorStop(1, "rgba(255,143,94,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sunX, sunY, 56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd28a"; ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(9, width * 0.018), 0, Math.PI * 2); ctx.fill();
    }
    drawCloudBand(ctx, width, horizonY - height * 0.055, Math.max(m.localLow, m.pathLowAvg), "rgba(31,38,52,ALPHA)", drift, 1.2);
    if (["BLOCKED", "PATCHY", "OVERCAST"].includes(scene.id)) {
      const bandOpacity = scene.id === "OVERCAST" ? 0.84 : scene.id === "BLOCKED" ? 0.7 : 0.5;
      ctx.fillStyle = `rgba(28,32,42,${bandOpacity})`;
      ctx.beginPath(); ctx.moveTo(0, horizonY - height * 0.055);
      for (let x = 0; x <= width; x += width / 8) ctx.lineTo(x, horizonY - height * (0.05 + 0.018 * Math.sin(x * 0.025 + seconds * 0.05)));
      ctx.lineTo(width, horizonY + height * 0.05); ctx.lineTo(0, horizonY + height * 0.05); ctx.closePath(); ctx.fill();
    }
    const land = ctx.createLinearGradient(0, horizonY, 0, height); land.addColorStop(0, "rgba(8,11,18,.82)"); land.addColorStop(1, "rgba(3,6,11,1)");
    ctx.fillStyle = land; ctx.beginPath(); ctx.moveTo(0, horizonY + height * 0.015); ctx.lineTo(width * 0.22, horizonY - height * 0.01); ctx.lineTo(width * 0.48, horizonY + height * 0.005); ctx.lineTo(width * 0.72, horizonY - height * 0.012); ctx.lineTo(width, horizonY + height * 0.004); ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
  }

  function renderEvidence() {
    const day = state.day;
    if (!day) return;
    const localLow = day.weather?.cloudLowPct, localMid = day.weather?.cloudMidPct, localHigh = day.weather?.cloudHighPct, visibility = day.weather?.visibilityKm;
    const samples = horizonValues(day).filter((sample) => sample.distanceKm > 0);
    const strongestLow = samples.reduce((best, sample) => numberOr(sample.cloudLowPct, -1) > numberOr(best?.cloudLowPct, -1) ? sample : best, null);
    const elevated = Math.max(numberOr(localMid), numberOr(localHigh));
    const items = [];
    if (finite(localLow)) items.push({ tone: localLow >= 55 ? "negative" : "positive", icon: localLow >= 55 ? "−" : "+", title: localLow >= 55 ? "Local low cloud is substantial" : "Local low cloud is manageable", text: localLow >= 55 ? "Low cloud near the observer can interrupt the direct sunset disc." : "The nearby horizon has more room for direct light.", value: pct(localLow) });
    if (strongestLow && finite(strongestLow.cloudLowPct)) items.push({ tone: strongestLow.cloudLowPct >= 55 ? "negative" : "positive", icon: strongestLow.cloudLowPct >= 55 ? "−" : "+", title: `${strongestLow.distanceKm} km is the strongest distant low-cloud sample`, text: "This is the largest sampled low-cloud risk along the western path near sunset.", value: pct(strongestLow.cloudLowPct) });
    items.push({ tone: elevated >= 25 ? "positive" : "negative", icon: elevated >= 25 ? "+" : "−", title: elevated >= 25 ? "Elevated cloud can catch color" : "Little elevated cloud canvas", text: elevated >= 25 ? "Mid/high cloud gives late sunlight something to illuminate." : "Sparse mid/high cloud limits layered afterglow potential.", value: `${pct(localMid)} · ${pct(localHigh)}` });
    if (finite(visibility)) items.push({ tone: visibility >= 20 ? "positive" : "", icon: visibility >= 20 ? "+" : "·", title: visibility >= 20 ? "Long visibility" : "Visibility is limited", text: visibility >= 20 ? "Clearer air helps preserve horizon definition and distant color structure." : "Haze may soften distant contrast.", value: `${Math.round(visibility)} km` });
    const list = $("#why-list");
    if (list) list.innerHTML = items.slice(0, 4).map((item) => `<div class="evidence-item ${item.tone ? `is-${item.tone}` : ""}"><div class="evidence-icon">${item.icon}</div><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p></div><div class="evidence-value">${escapeHtml(item.value)}</div></div>`).join("");
    setText("[data-cloud-high]", pct(localHigh)); setText("[data-cloud-mid]", pct(localMid)); setText("[data-cloud-low]", pct(localLow));
    setBar("[data-cloud-high-bar]", localHigh); setBar("[data-cloud-mid-bar]", localMid); setBar("[data-cloud-low-bar]", localLow);
    setText("[data-cloud-summary]", numberOr(localLow) >= 60 ? "Low-cloud heavy" : elevated >= 35 ? "Layered canvas" : "Open / sparse");
  }

  function setBar(selector, value) { const el = $(selector); if (el) el.style.width = `${clamp(numberOr(value), 0, 100)}%`; }

  function buildFallbackLightPath(day) {
    return { date: day.date, event: day.event, interpolation: "static-near-sunset-fallback", frames: [{ time: day.event?.time || new Date().toISOString(), samples: horizonValues(day) }] };
  }

  function interpolateNullable(a, b, t) { if (finite(a) && finite(b)) return lerp(a, b, t); if (finite(a)) return a; if (finite(b)) return b; return null; }

  function interpolateLightFrames(lightPath, targetMs) {
    const frames = Array.isArray(lightPath?.frames) ? lightPath.frames : [];
    if (!frames.length) return [];
    if (frames.length === 1) return frames[0].samples || [];
    const sorted = [...frames].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (targetMs <= Date.parse(sorted[0].time)) return sorted[0].samples || [];
    if (targetMs >= Date.parse(sorted.at(-1).time)) return sorted.at(-1).samples || [];
    let left = sorted[0], right = sorted[1];
    for (let i = 1; i < sorted.length; i += 1) if (Date.parse(sorted[i].time) >= targetMs) { right = sorted[i]; left = sorted[i - 1]; break; }
    const leftMs = Date.parse(left.time), rightMs = Date.parse(right.time), t = clamp((targetMs - leftMs) / Math.max(1, rightMs - leftMs), 0, 1);
    return [0, 25, 50, 100, 200].map((distanceKm) => {
      const a = (left.samples || []).find((sample) => sample.distanceKm === distanceKm) || {};
      const b = (right.samples || []).find((sample) => sample.distanceKm === distanceKm) || {};
      return { distanceKm, cloudLowPct: interpolateNullable(a.cloudLowPct, b.cloudLowPct, t), cloudMidPct: interpolateNullable(a.cloudMidPct, b.cloudMidPct, t), cloudHighPct: interpolateNullable(a.cloudHighPct, b.cloudHighPct, t) };
    });
  }

  function lightWindow() {
    const event = state.lightPath?.event || state.day?.event || {}, frames = state.lightPath?.frames || [];
    let start = event.goldenHourStart ? Date.parse(event.goldenHourStart) : Date.parse(frames[0]?.time || "");
    let end = event.lastUsefulLight ? Date.parse(event.lastUsefulLight) : event.blueHourEnd ? Date.parse(event.blueHourEnd) : Date.parse(frames.at(-1)?.time || "");
    const sunset = event.time ? Date.parse(event.time) : NaN;
    if (!Number.isFinite(start) && Number.isFinite(sunset)) start = sunset - 45 * 60000;
    if (!Number.isFinite(end) && Number.isFinite(sunset)) end = sunset + 45 * 60000;
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end, sunset } : null;
  }

  function setInitialScrubber() {
    const slider = $("#light-scrubber"), windowInfo = lightWindow();
    if (!slider || !windowInfo) return;
    let target = Number.isFinite(windowInfo.sunset) ? windowInfo.sunset : (windowInfo.start + windowInfo.end) / 2;
    if (isSelectedToday()) target = clamp(Date.now(), windowInfo.start, windowInfo.end);
    slider.value = String(Math.round(clamp((target - windowInfo.start) / (windowInfo.end - windowInfo.start), 0, 1) * 1000));
    setText("[data-scrub-start]", `Golden ${formatTime(new Date(windowInfo.start).toISOString())}`);
    setText("[data-scrub-sunset]", `Sunset ${formatTime(state.day?.event?.time)}`);
    setText("[data-scrub-end]", `Last light ${formatTime(new Date(windowInfo.end).toISOString())}`);
    renderLightAtSlider();
  }

  function rayLayerAtDistance(altitudeDeg, distanceKm) {
    if (altitudeDeg < -0.833) return null;
    const heightKm = distanceKm * Math.tan(altitudeDeg * Math.PI / 180) + (distanceKm * distanceKm) / (2 * 6371.0088);
    if (heightKm < 3) return { key: "cloudLowPct", label: "low", heightKm };
    if (heightKm < 8) return { key: "cloudMidPct", label: "mid", heightKm };
    return { key: "cloudHighPct", label: "high", heightKm };
  }

  function lightAssessment(samples, altitude) {
    let blocking = null;
    if (altitude >= -0.833) {
      samples.filter((sample) => sample.distanceKm > 0).forEach((sample) => {
        const intersection = rayLayerAtDistance(altitude, sample.distanceKm);
        if (!intersection) return;
        const value = numberOr(sample[intersection.key], -1);
        if (!blocking || value > blocking.value) blocking = { distanceKm: sample.distanceKm, layer: intersection.label, value, heightKm: intersection.heightKm };
      });
    }
    let canvas = null;
    samples.forEach((sample) => [["cloudMidPct", "mid"], ["cloudHighPct", "high"]].forEach(([key, label]) => {
      const value = numberOr(sample[key], -1);
      if (!canvas || value > canvas.value) canvas = { distanceKm: sample.distanceKm, layer: label, value };
    }));
    return { blocking, canvas };
  }

  function renderLightAtSlider() {
    const slider = $("#light-scrubber"), windowInfo = lightWindow();
    if (!slider || !windowInfo || !state.lightPath) return;
    const fraction = clamp(Number(slider.value) / 1000, 0, 1), timeMs = windowInfo.start + fraction * (windowInfo.end - windowInfo.start);
    const samples = interpolateLightFrames(state.lightPath, timeMs);
    const sun = sunPosition(new Date(timeMs), state.day?.location?.latitude ?? 32.794, state.day?.location?.longitude ?? 34.9896);
    const assessment = lightAssessment(samples, sun.altitude), phase = lightPhase(timeMs, state.day?.event);
    setText("[data-light-time]", formatTime(new Date(timeMs).toISOString())); setText("[data-light-phase]", phase.label); setText("[data-light-title]", phase.title);
    setText("[data-light-altitude]", `${sun.altitude >= 0 ? "+" : ""}${sun.altitude.toFixed(1)}°`);
    setText("[data-light-block]", assessment.blocking && assessment.blocking.value >= 0 ? `${assessment.blocking.distanceKm} km ${assessment.blocking.layer} · ${Math.round(assessment.blocking.value)}%` : sun.altitude < -0.833 ? "Direct sun below horizon" : "No strong sampled intersection");
    setText("[data-light-canvas]", assessment.canvas && assessment.canvas.value >= 0 ? `${assessment.canvas.distanceKm === 0 ? "Here" : `${assessment.canvas.distanceKm} km`} ${assessment.canvas.layer} · ${Math.round(assessment.canvas.value)}%` : "Sparse elevated cloud");
    setText("[data-light-insight]", buildLightInsight(sun.altitude, assessment));
    drawLightCanvas(samples, sun.altitude, assessment); renderMatrix(samples);
  }

  function lightPhase(timeMs, event = {}) {
    const sunset = Date.parse(event?.time || ""), blueStart = Date.parse(event?.blueHourStart || ""), end = Date.parse(event?.lastUsefulLight || event?.blueHourEnd || "");
    if (Number.isFinite(sunset) && timeMs < sunset - 20 * 60000) return { label: "Golden light", title: "Direct light is still descending" };
    if (Number.isFinite(sunset) && timeMs <= sunset + 5 * 60000) return { label: "Sunset", title: "The direct beam is at the horizon" };
    if (Number.isFinite(blueStart) && timeMs < blueStart) return { label: "Afterglow", title: "The disc is down; elevated cloud can still ignite" };
    if (Number.isFinite(end) && timeMs <= end) return { label: "Blue hour", title: "Only elevated twilight light remains" };
    return { label: "Late twilight", title: "Useful sunset light is fading" };
  }

  function buildLightInsight(altitude, assessment) {
    if (altitude < -0.833) {
      if (assessment.canvas && assessment.canvas.value >= 30) return `The sun is below the geometric horizon, but ${assessment.canvas.layer} cloud around ${assessment.canvas.distanceKm === 0 ? "Haifa" : `${assessment.canvas.distanceKm} km`} still offers the strongest sampled afterglow canvas.`;
      return "The direct sun is below the horizon and elevated cloud is sparse, so remaining color is likely to fade quickly.";
    }
    if (assessment.blocking && assessment.blocking.value >= 55) return `The direct-light ray crosses the ${assessment.blocking.layer} layer near ${assessment.blocking.distanceKm} km, where model cloud cover is ${Math.round(assessment.blocking.value)}%. Treat this as the strongest sampled obstruction risk, not a guaranteed solid cloud wall.`;
    return "No sampled ray intersection is especially cloud-heavy at this moment; the direct disc has a comparatively workable light path.";
  }

  function drawLightCanvas(samples, altitude, assessment) {
    const canvas = $("#lightpath-canvas"); if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const { width, height } = fitCanvas(canvas, ctx); ctx.clearRect(0, 0, width, height);
    const sky = ctx.createLinearGradient(0, 0, 0, height); sky.addColorStop(0, "#10294a"); sky.addColorStop(0.52, "#0c2038"); sky.addColorStop(1, "#08111d"); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    const left = width * 0.09, right = width * 0.88, horizonY = height * 0.82;
    const layerY = { high: height * 0.23, mid: height * 0.45, low: height * 0.68 }, layerColors = { high: "rgba(174,140,255,.66)", mid: "rgba(128,160,255,.58)", low: "rgba(255,181,106,.58)" };
    ctx.strokeStyle = "rgba(187,221,246,.10)"; ctx.lineWidth = 1;
    [["High cloud · 8 km+", layerY.high], ["Mid cloud · 3–8 km", layerY.mid], ["Low cloud · 0–3 km", layerY.low]].forEach(([label, y]) => { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.fillStyle = "rgba(170,199,222,.52)"; ctx.font = "11px ui-sans-serif, system-ui"; ctx.fillText(label, left, y - 10); });
    ctx.beginPath(); ctx.moveTo(left, horizonY); ctx.lineTo(right, horizonY); ctx.strokeStyle = "rgba(220,235,247,.22)"; ctx.stroke();
    const positions = [0, 25, 50, 100, 200].map((distance, index) => ({ distance, x: left + (right - left) * (index / 4) }));
    positions.forEach(({ distance, x }) => { ctx.strokeStyle = "rgba(180,213,240,.06)"; ctx.beginPath(); ctx.moveTo(x, height * 0.15); ctx.lineTo(x, horizonY); ctx.stroke(); ctx.fillStyle = "rgba(185,211,231,.65)"; ctx.font = "600 11px ui-sans-serif, system-ui"; const label = distance === 0 ? "HERE" : `${distance} KM`; ctx.fillText(label, x - ctx.measureText(label).width / 2, horizonY + 26); });
    const cloudLayer = (sample, key, layer) => {
      const value = numberOr(sample?.[key]); if (value <= 2) return;
      const pos = positions.find((item) => item.distance === sample.distanceKm); if (!pos) return;
      const y = layerY[layer], alpha = clamp(value / 100, .08, .85); ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = layerColors[layer];
      const rx = 18 + value * 0.28, ry = 8 + value * 0.08; ctx.beginPath(); ctx.ellipse(pos.x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(pos.x + rx * .35, y - ry * .38, rx * .62, ry * .74, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = "rgba(221,236,247,.74)"; ctx.font = "700 10px ui-sans-serif, system-ui"; ctx.fillText(`${Math.round(value)}%`, pos.x - 12, y + 4);
    };
    samples.forEach((sample) => { cloudLayer(sample, "cloudHighPct", "high"); cloudLayer(sample, "cloudMidPct", "mid"); cloudLayer(sample, "cloudLowPct", "low"); });
    const sunX = width * 0.94, sunY = clamp(horizonY - altitude * (height * 0.032), height * 0.08, height * 0.92), observerX = left, observerY = horizonY - 2;
    ctx.save(); const beam = ctx.createLinearGradient(observerX, observerY, sunX, sunY); beam.addColorStop(0, "rgba(110,225,255,.65)"); beam.addColorStop(.64, "rgba(255,207,130,.65)"); beam.addColorStop(1, "rgba(255,151,94,.85)"); ctx.strokeStyle = beam; ctx.lineWidth = 2.4;
    if (assessment.blocking && assessment.blocking.value >= 65) ctx.setLineDash([9, 7]);
    if (altitude >= -0.833) { ctx.beginPath(); ctx.moveTo(observerX, observerY); ctx.lineTo(sunX, sunY); ctx.stroke(); }
    else { ctx.globalAlpha = .38; ctx.beginPath(); ctx.moveTo(sunX, sunY); ctx.lineTo(width * .55, layerY.mid); ctx.stroke(); ctx.beginPath(); ctx.moveTo(sunX, sunY); ctx.lineTo(width * .35, layerY.high); ctx.stroke(); }
    ctx.restore();
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 45); halo.addColorStop(0, "rgba(255,247,211,.8)"); halo.addColorStop(.2, "rgba(255,190,107,.55)"); halo.addColorStop(1, "rgba(255,143,87,0)"); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sunX, sunY, 45, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#ffd28b"; ctx.beginPath(); ctx.arc(sunX, sunY, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#bdefff"; ctx.beginPath(); ctx.arc(observerX, observerY, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "rgba(189,239,255,.18)"; ctx.beginPath(); ctx.arc(observerX, observerY, 13, 0, Math.PI * 2); ctx.fill();
  }

  function renderMatrix(samples) {
    const matrix = $("#horizon-matrix"); if (!matrix) return;
    const distances = [0, 25, 50, 100, 200], layers = [["High", "8 km+", "cloudHighPct"], ["Mid", "3–8 km", "cloudMidPct"], ["Low", "0–3 km", "cloudLowPct"]];
    let html = `<div class="matrix-corner"></div>`;
    distances.forEach((distance) => { html += `<div class="matrix-distance"><strong>${distance === 0 ? "Here" : distance}</strong><span>${distance === 0 ? "0 km" : "km"}</span></div>`; });
    layers.forEach(([label, height, key]) => { html += `<div class="matrix-layer"><strong>${label}</strong><span>${height}</span></div>`; distances.forEach((distance) => { const sample = samples.find((item) => item.distanceKm === distance); html += `<div class="matrix-cell"><strong>${pct(sample?.[key])}</strong><span>cloud</span></div>`; }); });
    matrix.innerHTML = html;
  }

  function renderHistory() {
    const snapshots = Array.isArray(state.history?.snapshots) ? state.history.snapshots.filter((item) => finite(item.qualityScore)) : [];
    const empty = $("#journey-empty"), line = $("#journey-line"), points = $("#journey-points");
    if (snapshots.length < 2) { if (empty) empty.classList.remove("is-hidden"); if (line) line.setAttribute("d", ""); if (points) points.innerHTML = ""; }
    else {
      if (empty) empty.classList.add("is-hidden"); const values = snapshots.map((item) => clamp(item.qualityScore, 0, 100)), width = 684, x0 = 46, y0 = 212, height = 172;
      const coords = values.map((value, index) => ({ x: x0 + width * (index / Math.max(1, values.length - 1)), y: y0 - height * (value / 100) }));
      const d = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
      if (line) { line.setAttribute("d", d); line.style.strokeDasharray = "900"; line.style.strokeDashoffset = reduceMotion ? "0" : "900"; requestAnimationFrame(() => { if (line) line.style.strokeDashoffset = "0"; }); }
      if (points) points.innerHTML = coords.map((point) => `<circle class="journey-point" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join("");
    }
    const first = snapshots[0]?.qualityScore, latest = snapshots.at(-1)?.qualityScore, best = snapshots.length ? Math.max(...snapshots.map((item) => item.qualityScore)) : null;
    setText("[data-journey-first]", finite(first) ? Math.round(first) : "—"); setText("[data-journey-best]", finite(best) ? Math.round(best) : "—"); setText("[data-journey-now]", finite(latest) ? Math.round(latest) : "—");
    setText("[data-journey-delta]", finite(first) && finite(latest) ? `${Math.round(latest - first) > 0 ? "+" : ""}${Math.round(latest - first)} pts` : "Collecting snapshots"); renderChanges(snapshots);
  }

  function renderChanges(snapshots) {
    const list = $("#change-list"); if (!list) return;
    if (snapshots.length < 2) { list.innerHTML = `<div class="change-row"><span>No earlier comparable snapshot yet</span><strong>—</strong></div>`; setText("[data-change-note]", "Future days and newly started days need another snapshot before change attribution appears."); return; }
    const prev = snapshots.at(-2), curr = snapshots.at(-1), prev200 = (prev.horizon || []).find((item) => item.distanceKm === 200), curr200 = (curr.horizon || []).find((item) => item.distanceKm === 200);
    const rows = [["Quality", diffLabel(curr.qualityScore, prev.qualityScore, "pts")], ["Local low cloud", diffLabel(curr.weather?.cloudLowPct, prev.weather?.cloudLowPct, "pp")], ["200 km low cloud", diffLabel(curr200?.cloudLowPct, prev200?.cloudLowPct, "pp")], ["Visibility", diffLabel(curr.weather?.visibilityKm, prev.weather?.visibilityKm, "km")]];
    list.innerHTML = rows.map(([label, value]) => `<div class="change-row"><span>${label}</span><strong>${value}</strong></div>`).join(""); setText("[data-change-note]", "Changes use persisted provider evidence; no separate AI score is introduced.");
  }

  function diffLabel(current, previous, unit) { if (!finite(current) || !finite(previous)) return "—"; const rounded = Math.round(current - previous); return `${rounded > 0 ? "+" : ""}${rounded} ${unit}`; }

  function renderNextDays() {
    const container = $("#next-days"); if (!container) return;
    container.innerHTML = state.days.map((item, index) => `<button class="next-day ${index === state.selectedIndex ? "is-active" : ""}" type="button" data-next-index="${index}"><div class="next-day__top"><div class="next-day__date"><strong>${escapeHtml(dateLabel(item.date, index))}</strong><span>${escapeHtml(fullDateLabel(item.date))}</span></div><div class="next-day__score">${finite(item.qualityScore) ? Math.round(item.qualityScore) : "—"}</div></div><div class="next-day__bottom"><span class="next-day__state">${escapeHtml(item.recommendation || "Unavailable")}</span><span class="next-day__sunset">${formatTime(item.sunsetTime)} sunset</span></div></button>`).join("");
    $$("[data-next-index]", container).forEach((button) => button.addEventListener("click", () => selectDay(Number(button.dataset.nextIndex), true)));
  }

  function renderConfidence() {
    const day = state.day; if (!day) return;
    setText("[data-confidence-big]", day.recommendation?.confidence || "LOW");
    const horizonComplete = Array.isArray(day.horizon) && day.horizon.length === 4 && day.horizon.every((sample) => finite(sample.cloudLowPct) && finite(sample.cloudMidPct) && finite(sample.cloudHighPct));
    const lightFrames = state.lightPath?.frames || [];
    const checks = [[!day.freshness?.stale, day.freshness?.stale ? "Sunsethue data is stale." : "Sunsethue forecast is within the accepted freshness window."], [horizonComplete, horizonComplete ? "All four western distances include low / mid / high cloud." : "Some layered horizon evidence is missing."], [lightFrames.length >= 2, lightFrames.length >= 2 ? `${lightFrames.length} time-varying light-path model frames are available.` : "Only static near-sunset light-path evidence is available."], [finite(day.weather?.visibilityKm), finite(day.weather?.visibilityKm) ? "Visibility context is available." : "Visibility context is unavailable."]];
    const box = $("#confidence-checks"); if (box) box.innerHTML = checks.map(([ok, text]) => `<div class="confidence-check"><i>${ok ? "✓" : "—"}</i><span>${escapeHtml(text)}</span></div>`).join("");
    setText("[data-source-sunsethue]", formatAge(day.freshness?.sunsethueAt)); setText("[data-source-weather]", formatAge(day.freshness?.weatherAt)); setText("[data-source-page]", "just now");
  }

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }

  function showToast(message) {
    const toast = $("#status-toast"); if (!toast) return;
    toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  async function loadDay(index) {
    const item = state.days[index]; if (!item) return;
    state.selectedIndex = index; renderDayNavigation(); renderNextDays(); setText("[data-live-label]", "Updating");
    let day;
    try {
      const path = index === 0 ? `/current?location=${encodeURIComponent(LOCATION)}` : `/day?location=${encodeURIComponent(LOCATION)}&date=${encodeURIComponent(item.date)}`;
      day = await getJson(path); storeDay(day);
    } catch (error) {
      day = readCachedDay(item.date); if (!day) throw error; showToast("Showing the last saved forecast while the live service recovers.");
    }
    state.day = day; renderHero(); renderScene(); renderEvidence();
    const [historyResult, lightResult] = await Promise.allSettled([getJson(`/history?location=${encodeURIComponent(LOCATION)}&date=${encodeURIComponent(item.date)}`), getJson(`/light-path?location=${encodeURIComponent(LOCATION)}&date=${encodeURIComponent(item.date)}`)]);
    state.history = historyResult.status === "fulfilled" ? historyResult.value : { date: item.date, snapshots: [] };
    state.lightPath = lightResult.status === "fulfilled" ? lightResult.value : buildFallbackLightPath(day);
    const loading = $("#light-loading"); if (loading) { loading.textContent = lightResult.status === "fulfilled" ? "" : "Live time series unavailable · using the near-sunset layer snapshot"; loading.classList.toggle("is-hidden", lightResult.status === "fulfilled"); }
    const slider = $("#light-scrubber"); if (slider) slider.disabled = !state.lightPath?.frames?.length;
    setInitialScrubber(); renderHistory(); renderNextDays(); renderConfidence(); setText("[data-live-label]", day.freshness?.stale ? "Cached forecast" : "Live forecast"); document.body.classList.remove("is-loading");
  }

  async function selectDay(index, scrollToHero = false) {
    if (!state.days[index]) return;
    if (index === state.selectedIndex && state.day) { if (scrollToHero) $("#top")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); return; }
    try { await loadDay(index); if (scrollToHero) $("#top")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); } catch { showToast("That evening’s detail could not be loaded."); }
  }

  function installEvents() {
    $$(".day-tab").forEach((button) => button.addEventListener("click", () => selectDay(Number(button.dataset.dayIndex), false)));
    $("#light-scrubber")?.addEventListener("input", renderLightAtSlider);
    window.addEventListener("resize", () => { if (state.day) { renderHeroTimeline(); renderScene(); renderLightAtSlider(); } });
  }

  function installReveal() {
    const elements = $$(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) { elements.forEach((element) => element.classList.add("is-visible")); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    elements.forEach((element) => observer.observe(element));
  }

  async function bootstrap() {
    installEvents(); installReveal();
    try {
      state.forecast = await getJson(`/forecast?location=${encodeURIComponent(LOCATION)}&days=3`); state.days = Array.isArray(state.forecast?.days) ? state.forecast.days : [];
      if (!state.days.length) throw new Error("NO_FORECAST_DAYS");
      renderDayNavigation(); renderNextDays(); await loadDay(0);
    } catch {
      try {
        const current = await getJson(`/current?location=${encodeURIComponent(LOCATION)}`);
        state.days = [{ date: current.date, qualityScore: current.quality?.score, recommendation: current.recommendation?.state, confidence: current.recommendation?.confidence, sunsetTime: current.event?.time }]; state.day = current;
        renderDayNavigation(); renderHero(); renderScene(); renderEvidence(); state.lightPath = buildFallbackLightPath(current); setInitialScrubber(); renderHistory(); renderNextDays(); renderConfidence();
      } catch {
        setText("[data-live-label]", "Forecast unavailable"); setText("[data-headline]", "The forecast service is temporarily unavailable."); setText("[data-summary]", "Sunset Signal will recover automatically when the provider connection returns.");
      }
      document.body.classList.remove("is-loading");
    }
  }

  bootstrap();
})();
