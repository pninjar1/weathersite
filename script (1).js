/* =========================================================
   SKYCAST — script.js
   Vanilla ES6+ · Open-Meteo Geocoding + Forecast APIs
   ========================================================= */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     1. Config, state and small helpers
     --------------------------------------------------------- */
  const API = {
    geo: 'https://geocoding-api.open-meteo.com/v1/search',
    forecast: 'https://api.open-meteo.com/v1/forecast',
  };
  // Only used as the starting point; all weather values still come from the API.
  const DEFAULT_LOCATION = { name: 'Lagos', admin1: 'Lagos', country: 'Nigeria', countryCode: 'NG', latitude: 6.5244, longitude: 3.3792 };
  const STORE = { unit: 'skycast.unit', loc: 'skycast.location', recent: 'skycast.recent' };
  const REFRESH_MS = 10 * 60 * 1000;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const rand = (a, b) => a + Math.random() * (b - a);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  };

  const validLoc = (l) => l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude) && typeof l.name === 'string';

  const state = {
    unit: store.get(STORE.unit, 'C') === 'F' ? 'F' : 'C',
    loc: validLoc(store.get(STORE.loc)) ? store.get(STORE.loc) : DEFAULT_LOCATION,
    data: null,
    fmt: null,
    chartMode: 'hourly',
    loadToken: 0,
    lastUpdated: 0,
  };

  /* ---------------------------------------------------------
     2. WMO weather codes → description + icon kind
     --------------------------------------------------------- */
  const WMO = {
    0: ['Clear sky', 'clear'], 1: ['Mainly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
    45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'],
    51: ['Light drizzle', 'rain'], 53: ['Moderate drizzle', 'rain'], 55: ['Dense drizzle', 'rain'],
    56: ['Light freezing drizzle', 'rain'], 57: ['Dense freezing drizzle', 'rain'],
    61: ['Slight rain', 'rain'], 63: ['Moderate rain', 'rain'], 65: ['Heavy rain', 'rain'],
    66: ['Light freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
    71: ['Slight snow', 'snow'], 73: ['Moderate snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
    80: ['Slight rain showers', 'rain'], 81: ['Moderate rain showers', 'rain'], 82: ['Violent rain showers', 'rain'],
    85: ['Slight snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
    95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm with slight hail', 'storm'], 99: ['Thunderstorm with heavy hail', 'storm'],
  };
  const FX_OF = { clear: 'clear', partly: 'cloudy', cloud: 'cloudy', fog: 'fog', rain: 'rain', snow: 'snow', storm: 'storm' };
  const wmo = (code) => WMO[code] || ['Unknown conditions', 'cloud'];
  const isSnowCode = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const isWetCode = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95 || isSnowCode(c);

  /* ---------------------------------------------------------
     3. Inline SVG weather icons (gradients live in index.html)
     --------------------------------------------------------- */
  const RAYS = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `<line x1="${(32 + c * 17).toFixed(1)}" y1="${(32 + s * 17).toFixed(1)}" x2="${(32 + c * 23).toFixed(1)}" y2="${(32 + s * 23).toFixed(1)}"/>`;
  }).join('');
  const SUN = `<g class="ic-sun"><g class="ic-rays" stroke="#ffd45e" stroke-width="3" stroke-linecap="round">${RAYS}</g><circle cx="32" cy="32" r="11" fill="url(#gSun)"/></g>`;
  const MOON = `<circle cx="30" cy="34" r="17" fill="url(#gMoon)" mask="url(#mMoon)"/>`;
  const cloud = (t = '', dark = false) =>
    `<g transform="${t}" fill="url(#${dark ? 'gCloudDark' : 'gCloud'})"><circle cx="24" cy="38" r="9"/><circle cx="35" cy="31" r="12"/><circle cx="45" cy="39" r="8"/><rect x="24" y="38" width="21" height="9"/></g>`;

  function iconMarkup(kind, isDay) {
    const body = isDay ? SUN : MOON;
    let inner;
    switch (kind) {
      case 'clear': inner = isDay ? SUN : `<g transform="translate(2 0)">${MOON}</g>`; break;
      case 'partly': inner = `<g transform="translate(-7 -9) scale(.8)">${body}</g>${cloud('translate(4 6)')}`; break;
      case 'cloud': inner = `${cloud('translate(-9 -5) scale(.78)', true)}${cloud('translate(2 3)')}`; break;
      case 'fog': inner = `${cloud('translate(0 -8)', true)}<g stroke="#9fb4d4" stroke-width="3" stroke-linecap="round"><line x1="16" y1="45" x2="48" y2="45"/><line x1="12" y1="51" x2="44" y2="51"/><line x1="18" y1="57" x2="50" y2="57"/></g>`; break;
      case 'rain': inner = `${cloud('translate(0 -8)', true)}<g class="ic-drops" stroke="#4fd1ff" stroke-width="3" stroke-linecap="round"><line x1="25" y1="43" x2="22" y2="52"/><line x1="35" y1="43" x2="32" y2="52"/><line x1="45" y1="43" x2="42" y2="52"/></g>`; break;
      case 'snow': inner = `${cloud('translate(0 -8)', true)}<g class="ic-flakes" fill="#fff"><circle cx="25" cy="47" r="2.4"/><circle cx="35" cy="52" r="2.4"/><circle cx="45" cy="47" r="2.4"/></g>`; break;
      case 'storm': inner = `${cloud('translate(0 -8)', true)}<polygon class="ic-bolt" points="35,36 26,50 32,50 29,61 43,43 36,43 40,36" fill="#ffd45e"/>`; break;
      default: inner = cloud('translate(0 0)');
    }
    return `<svg class="wx-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${inner}</svg>`;
  }
  const iconFor = (code, isDay) => iconMarkup(wmo(code)[1], !!isDay);

  const DROP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>';
  const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const CLOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  const LOCATE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

  /* ---------------------------------------------------------
     4. Formatting (temperature units, dates, times)
     --------------------------------------------------------- */
  const toUnit = (c) => (state.unit === 'F' ? (c * 9) / 5 + 32 : c);
  const round0 = (n) => Math.round(n) || 0; // avoids "-0"
  const fmtTemp = (c) => (c == null || Number.isNaN(c) ? '--' : `${round0(toUnit(c))}°`);

  function makeFormatters(tz) {
    const build = (opts) => {
      try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }); }
      catch { return new Intl.DateTimeFormat('en-US', opts); }
    };
    return {
      time: build({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
      date: build({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      hour: build({ hour: 'numeric', hourCycle: 'h23' }),
    };
  }
  const deviceDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const deviceTime = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const utcDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
  const utcMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

  const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  const clock12 = (iso) => { // "2026-11-25T06:23" → "6:23 AM"
    const [h, m] = iso.slice(11, 16).split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const dayDate = (isoDate) => new Date(`${isoDate}T00:00:00Z`);

  const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) / 22.5)) % 16];

  /* ---------------------------------------------------------
     5. Network helper (timeout + readable errors)
     --------------------------------------------------------- */
  async function fetchJSON(url, { signal, timeout = 12000 } = {}) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`The service responded with status ${res.status}.`);
      const json = await res.json();
      if (json && json.error) throw new Error(json.reason || 'The weather service reported an error.');
      return json;
    } catch (err) {
      if (timedOut) throw new Error('The request timed out. Please check your connection and try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------
     6. Weather loading & parsing
     --------------------------------------------------------- */
  function forecastUrl(loc) {
    const p = new URLSearchParams({
      latitude: loc.latitude,
      longitude: loc.longitude,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,weather_code,precipitation_probability,visibility,uv_index,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
      timezone: 'auto',
      forecast_days: 8, // extra day so a full 24h window always exists late in the evening
      wind_speed_unit: 'kmh',
    });
    return `${API.forecast}?${p}`;
  }

  /** Turns the raw API response into a compact structure used by every renderer. */
  function parseForecast(j) {
    if (!j || !j.current || !j.hourly || !j.daily) throw new Error('The weather service returned incomplete data.');
    const c = j.current, h = j.hourly, d = j.daily;

    // Hourly timestamps are in the location's timezone, so compare with current.time as plain strings.
    const nowHour = `${c.time.slice(0, 13)}:00`;
    let idx = h.time.findIndex((t) => t >= nowHour);
    if (idx < 0) idx = 0;

    const hours = h.time.slice(idx, idx + 24).map((t, k) => ({
      time: t,
      hour: Number(t.slice(11, 13)),
      temp: h.temperature_2m[idx + k],
      code: h.weather_code[idx + k],
      prob: h.precipitation_probability[idx + k],
      isDay: h.is_day[idx + k] === 1,
    }));

    const days = d.time.slice(0, 7).map((t, k) => ({
      date: t,
      code: d.weather_code[k],
      max: d.temperature_2m_max[k],
      min: d.temperature_2m_min[k],
      prob: d.precipitation_probability_max[k],
      sunrise: d.sunrise[k],
      sunset: d.sunset[k],
    }));

    return {
      tz: j.timezone,
      abbr: j.timezone_abbreviation,
      cur: {
        time: c.time,
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        isDay: c.is_day === 1,
        precip: c.precipitation,
        code: c.weather_code,
        cloud: c.cloud_cover,
        pressure: c.pressure_msl,
        windSpeed: c.wind_speed_10m,
        windDir: c.wind_direction_10m,
        visibility: h.visibility[idx] != null ? h.visibility[idx] / 1000 : null,
        uv: h.uv_index[idx],
      },
      hours,
      days,
    };
  }

  async function loadWeather(loc, { silent = false } = {}) {
    const token = ++state.loadToken;
    if (!silent) showLoader(true);
    hideError();
    setBusy($('#btn-refresh'), true);
    try {
      if (navigator.onLine === false) throw new Error('You appear to be offline. Reconnect and try again.');
      const data = parseForecast(await fetchJSON(forecastUrl(loc)));
      if (token !== state.loadToken) return; // a newer request superseded this one

      const next = { ...loc };
      if (next.isGeo) { // Open-Meteo has no reverse geocoder, so name the spot from its timezone
        const parts = (data.tz || '').split('/');
        next.name = (parts[parts.length - 1] || 'Your location').replace(/_/g, ' ');
        next.admin1 = '';
        next.country = 'Current location';
      }
      state.loc = next;
      state.data = data;
      state.lastUpdated = Date.now();
      store.set(STORE.loc, { ...next, isGeo: false });
      render();
    } catch (err) {
      if (token !== state.loadToken) return;
      showError(err.message || 'Something went wrong while loading the weather.');
    } finally {
      if (token === state.loadToken) { showLoader(false); setBusy($('#btn-refresh'), false); }
    }
  }

  /* ---------------------------------------------------------
     7. Rendering
     --------------------------------------------------------- */
  function render() {
    const d = state.data;
    if (!d) return;
    state.fmt = makeFormatters(d.tz);
    renderHero(d);
    renderMetrics(d);
    renderHourly(d);
    renderDaily(d);
    renderChart();
    applyScene(d);
    tick();
  }

  function renderHero(d) {
    const { cur, days } = d, loc = state.loc;
    const [desc, kind] = wmo(cur.code);
    $('#city-name').textContent = loc.name;
    $('#country-name').textContent = [loc.admin1 && loc.admin1 !== loc.name ? loc.admin1 : '', loc.country].filter(Boolean).join(', ');
    $('#tz-label').textContent = `${(d.tz || '').replace(/_/g, ' ')}${d.abbr && !/^[+-]/.test(d.abbr) ? ` · ${d.abbr}` : ''}`;
    $('#temp-value').textContent = round0(toUnit(cur.temp));
    $('#temp-unit').textContent = `°${state.unit}`;
    $('#condition').textContent = desc;
    $('#feels-like').textContent = fmtTemp(cur.feels);
    $('#temp-hi').textContent = fmtTemp(days[0].max);
    $('#temp-lo').textContent = fmtTemp(days[0].min);
    $('#hero-icon').innerHTML = iconMarkup(kind, cur.isDay);
    $('#sunrise').textContent = clock12(days[0].sunrise);
    $('#sunset').textContent = clock12(days[0].sunset);
    $('#updated-at').textContent = new Date(state.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const insight = buildInsight(d);
    $('#insight-text').textContent = insight.text;
    $('#insight-icon').innerHTML = insight.icon;
  }

  /** A short human sentence derived from the real hourly data. */
  function buildInsight(d) {
    const { cur, hours } = d;
    const next = hours.slice(0, 13);
    const wetNow = isWetCode(cur.code) || cur.precip > 0;
    const isWet = (h) => isWetCode(h.code) || (h.prob ?? 0) >= 50;
    const word = (code) => (isSnowCode(code) ? 'Snow' : 'Rain');
    const plural = (n) => `${n} hour${n === 1 ? '' : 's'}`;

    if (wetNow) {
      let n = 1;
      while (n < next.length && isWet(next[n])) n++;
      const text = n >= next.length ? `${word(cur.code)} is expected to continue for the next 12 hours or more.`
        : n <= 1 ? `${word(cur.code)} should ease within the hour.`
        : `${word(cur.code)} is expected to continue for the next ${plural(n - 1)}.`;
      return { text, icon: iconFor(cur.code, cur.isDay) };
    }
    const at = next.findIndex((h, i) => i > 0 && isWet(h));
    if (at > 0) return { text: `${word(next[at].code)} is likely in about ${plural(at)}.`, icon: iconFor(next[at].code, next[at].isDay) };
    return { text: 'No rain or snow expected over the next 12 hours.', icon: iconFor(cur.code === 0 ? 0 : 2, cur.isDay) };
  }

  /** Writes a value, sub-label and meter percentage into one metric card. */
  function setMetric(id, { value, sub = '', pct = 0, unit }) {
    const card = $(`[data-metric="${id}"]`);
    if (!card) return;
    $('.val', card).textContent = value;
    $('.sub', card).textContent = sub || '\u00a0';
    const meter = $('.meter span', card);
    if (meter) meter.style.width = `${clamp(pct, 0, 100)}%`;
    if (unit !== undefined) { const u = $('small', card); if (u) u.textContent = unit; }
  }

  function renderMetrics(d) {
    const c = d.cur, today = d.days[0];
    const lvl = (v, steps) => steps.find(([max]) => v < max)[1];
    const has = (v) => v != null && !Number.isNaN(v);

    setMetric('humidity', {
      value: has(c.humidity) ? round0(c.humidity) : '--', pct: c.humidity,
      sub: has(c.humidity) ? lvl(c.humidity, [[30, 'Dry'], [60, 'Comfortable'], [80, 'Humid'], [101, 'Very humid']]) : '',
    });
    setMetric('wind', {
      value: has(c.windSpeed) ? round0(c.windSpeed) : '--', pct: (c.windSpeed / 80) * 100,
      sub: has(c.windSpeed) ? lvl(c.windSpeed, [[6, 'Calm'], [20, 'Light breeze'], [40, 'Moderate wind'], [62, 'Strong wind'], [Infinity, 'Gale force']]) : '',
    });
    if (has(c.windDir)) {
      setMetric('direction', { value: compass(c.windDir), sub: `Blowing from ${round0(c.windDir)}°` });
      $('[data-metric="direction"] small').textContent = '';
      $('#dir-arrow').parentNode.style.transform = `rotate(${(c.windDir + 180) % 360}deg)`;
    } else setMetric('direction', { value: '--' });
    setMetric('pressure', {
      value: has(c.pressure) ? round0(c.pressure) : '--', pct: ((c.pressure - 980) / 60) * 100,
      sub: has(c.pressure) ? lvl(c.pressure, [[1009, 'Low'], [1023, 'Normal'], [Infinity, 'High']]) : '',
    });
    setMetric('visibility', {
      value: has(c.visibility) ? (c.visibility >= 10 ? round0(c.visibility) : c.visibility.toFixed(1)) : '--', pct: (c.visibility / 20) * 100,
      sub: has(c.visibility) ? lvl(c.visibility, [[1, 'Very poor'], [4, 'Poor'], [10, 'Moderate'], [20, 'Good'], [Infinity, 'Excellent']]) : '',
    });
    setMetric('uv', {
      value: has(c.uv) ? c.uv.toFixed(1) : '--', pct: (c.uv / 11) * 100,
      sub: has(c.uv) ? lvl(c.uv, [[3, 'Low'], [6, 'Moderate'], [8, 'High'], [11, 'Very high'], [Infinity, 'Extreme']]) : '',
    });
    setMetric('cloud', {
      value: has(c.cloud) ? round0(c.cloud) : '--', pct: c.cloud,
      sub: has(c.cloud) ? lvl(c.cloud, [[15, 'Clear'], [45, 'Partly cloudy'], [80, 'Mostly cloudy'], [101, 'Overcast']]) : '',
    });
    setMetric('precip', {
      value: has(c.precip) ? c.precip.toFixed(1) : '--', pct: has(today.prob) ? today.prob : (c.precip / 10) * 100,
      sub: has(today.prob) ? `${today.prob}% chance today` : '',
    });
  }

  function renderHourly(d) {
    $('#hourly-list').innerHTML = d.hours.map((h, i) => `
      <li class="hour${i === 0 ? ' now' : ''}">
        <span class="h-time">${i === 0 ? 'Now' : hourLabel(h.hour)}</span>
        <span class="h-icon">${iconFor(h.code, h.isDay)}</span>
        <span class="h-temp">${fmtTemp(h.temp)}</span>
        <span class="h-prob" title="Chance of precipitation">${DROP_SVG}${h.prob ?? 0}%</span>
      </li>`).join('');
    $('#hourly-list').scrollLeft = 0;
  }

  function renderDaily(d) {
    const lo = Math.min(...d.days.map((x) => x.min)), hi = Math.max(...d.days.map((x) => x.max));
    const span = hi - lo || 1;
    $('#daily-list').innerHTML = d.days.map((x, i) => {
      const dt = dayDate(x.date);
      const left = ((x.min - lo) / span) * 100;
      const width = Math.max(((x.max - x.min) / span) * 100, 6);
      return `
      <li class="day${i === 0 ? ' today' : ''}"${i === 0 ? ' aria-current="date"' : ''}>
        <span class="d-name">${i === 0 ? 'Today' : utcDay.format(dt)}<small>${utcMonthDay.format(dt)}</small></span>
        <span class="d-icon">${iconFor(x.code, true)}</span>
        <span class="d-desc"><span>${esc(wmo(x.code)[0])}</span><span class="d-prob">${DROP_SVG}${x.prob ?? 0}%</span></span>
        <span class="d-range" aria-hidden="true"><i style="left:${left.toFixed(1)}%;width:${Math.min(width, 100 - left).toFixed(1)}%"></i></span>
        <span class="d-temps"><b>${fmtTemp(x.max)}</b><span>${fmtTemp(x.min)}</span></span>
      </li>`;
    }).join('');
  }

  /* ---- Temperature chart (hand-built SVG, re-drawn to the container width) ---- */
  function smoothPath(pts) {
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function renderChart() {
    const wrap = $('#chart-wrap'), d = state.data;
    if (!wrap || !d) return;
    const W = Math.max(260, Math.floor(wrap.clientWidth));
    const H = W < 420 ? 210 : 250;
    const pad = { l: 20, r: 20, t: 40, b: 34 };

    let labels, series;
    if (state.chartMode === 'hourly') {
      labels = d.hours.map((h, i) => (i === 0 ? 'Now' : hourLabel(h.hour)));
      series = [{ vals: d.hours.map((h) => h.temp), alt: false }];
    } else {
      labels = d.days.map((x, i) => (i === 0 ? 'Today' : utcDay.format(dayDate(x.date))));
      series = [{ vals: d.days.map((x) => x.max), alt: false }, { vals: d.days.map((x) => x.min), alt: true }];
    }
    const n = labels.length;
    const all = series.flatMap((s) => s.vals).map(toUnit);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }

    const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / (n - 1);
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor((W - 40) / 56))));
    const base = H - pad.b;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Temperature ${state.chartMode} chart, ${round0(lo)} to ${round0(hi)} degrees ${state.unit}">
      <defs><linearGradient id="chFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22e4ff" stop-opacity=".35"/><stop offset="1" stop-color="#22e4ff" stop-opacity="0"/></linearGradient></defs>`;

    series.forEach((s, si) => {
      const pts = s.vals.map((v, i) => [x(i), y(toUnit(v))]);
      const line = smoothPath(pts);
      if (!s.alt) svg += `<path d="${line} L${pts[n - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z" fill="url(#chFill)"/>`;
      svg += `<path class="ch-line${s.alt ? ' alt' : ''}" d="${line}"/>`;
      pts.forEach((p, i) => {
        if (i % step !== 0) return;
        if (si === 0) svg += `<line class="ch-guide" x1="${p[0].toFixed(1)}" x2="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" y2="${base}"/>`;
        svg += `<circle class="ch-dot${s.alt ? ' alt' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4"/>`;
        svg += `<text class="ch-val${s.alt ? ' alt' : ''}" x="${p[0].toFixed(1)}" y="${(p[1] + (s.alt ? 20 : -12)).toFixed(1)}">${round0(toUnit(s.vals[i]))}°</text>`;
      });
    });
    labels.forEach((l, i) => { if (i % step === 0) svg += `<text class="ch-x" x="${x(i).toFixed(1)}" y="${H - 8}">${esc(l)}</text>`; });
    wrap.innerHTML = `${svg}</svg>`;
    wrap.dataset.w = W;
  }

  /* ---------------------------------------------------------
     8. Weather scene (CSS layers + lightweight canvas particles)
     --------------------------------------------------------- */
  function applyScene(d) {
    const fx = FX_OF[wmo(d.cur.code)[1]] || 'clear';
    document.body.dataset.weather = fx;
    document.body.dataset.day = d.cur.isDay ? 'true' : 'false';
    FX.set(fx);
  }

  const FX = (() => {
    const canvas = $('#fx-canvas'), ctx = canvas.getContext('2d'), bolt = $('#lightning');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let mode = 'none', parts = [], w = 0, h = 0, raf = 0, last = 0, boltTimer = 0;

    function spawn(init) {
      if (mode === 'snow') return { x: rand(0, w), y: init ? rand(0, h) : -8, r: rand(1, 3.2), v: rand(.5, 1.3), ph: rand(0, 6.28), a: rand(.4, .9) };
      const heavy = mode === 'storm' ? 1.25 : 1;
      return { x: rand(-h * .2, w), y: init ? rand(0, h) : rand(-60, 0), l: rand(10, 22), v: rand(14, 22) * heavy, a: rand(.15, .4) };
    }
    function seed() {
      const area = w * h;
      const n = mode === 'rain' ? clamp(area / 9000, 50, 150) : mode === 'storm' ? clamp(area / 6500, 80, 210) : mode === 'snow' ? clamp(area / 14000, 40, 110) : 0;
      parts = Array.from({ length: Math.round(n) }, () => spawn(true));
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    function frame(t) {
      raf = 0;
      if (mode === 'none' || document.hidden || reduce.matches) { ctx.clearRect(0, 0, w, h); return; }
      const dt = Math.min(3, (t - last) / 16.67 || 1);
      last = t;
      ctx.clearRect(0, 0, w, h);
      if (mode === 'snow') {
        ctx.fillStyle = '#fff';
        for (const p of parts) {
          p.ph += .02 * dt; p.x += Math.sin(p.ph) * .6 * dt; p.y += p.v * dt;
          if (p.y > h + 6) { p.y = -6; p.x = rand(0, w); }
          ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
      } else {
        ctx.strokeStyle = 'rgb(160,205,255)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
        for (const p of parts) {
          p.x += p.v * .2 * dt; p.y += p.v * dt;
          if (p.y > h || p.x > w + 20) { p.y = -p.l; p.x = rand(-h * .2, w); }
          ctx.globalAlpha = p.a; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * .2, p.y + p.l); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function scheduleBolt() {
      clearTimeout(boltTimer);
      if (mode !== 'storm' || reduce.matches) return;
      boltTimer = setTimeout(() => {
        bolt.classList.remove('strike'); void bolt.offsetWidth; bolt.classList.add('strike');
        scheduleBolt();
      }, rand(3500, 9000));
    }
    function start() { if (!raf) raf = requestAnimationFrame(frame); }

    function set(next) {
      mode = ['rain', 'snow', 'storm'].includes(next) ? next : 'none';
      seed(); scheduleBolt();
      if (mode === 'none') ctx.clearRect(0, 0, w, h); else start();
    }
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 200); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { start(); scheduleBolt(); } });
    reduce.addEventListener?.('change', () => { start(); scheduleBolt(); });
    resize();
    return { set };
  })();

  function buildStars() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i'), size = rand(1, 2.4);
      s.style.cssText = `left:${rand(0, 100).toFixed(1)}%;top:${rand(0, 100).toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;animation-delay:${rand(0, 4).toFixed(1)}s;animation-duration:${rand(3, 6).toFixed(1)}s`;
      frag.appendChild(s);
    }
    $('#stars').appendChild(frag);
  }

  /* ---------------------------------------------------------
     9. Live clocks (device time in header, location time in hero)
     --------------------------------------------------------- */
  function tick() {
    const now = new Date();
    $('#hdr-date').textContent = deviceDate.format(now);
    $('#hdr-time').textContent = deviceTime.format(now);
    if (!state.fmt) return;
    $('#local-time').textContent = state.fmt.time.format(now);
    $('#hero-date').textContent = state.fmt.date.format(now);
    const hr = parseInt(state.fmt.hour.format(now), 10);
    $('#greeting').textContent = hr >= 5 && hr < 12 ? 'Good morning' : hr >= 12 && hr < 17 ? 'Good afternoon' : hr >= 17 && hr < 21 ? 'Good evening' : 'Good night';
  }

  /* ---------------------------------------------------------
     10. Location search with corrections / alternatives
     --------------------------------------------------------- */
  // Used only to suggest spelling corrections for mistyped place names.
  const POPULAR = ['Lagos', 'Abuja', 'Ibadan', 'Kano', 'Port Harcourt', 'Benin City', 'Enugu', 'Kaduna', 'Accra', 'Kumasi', 'Nairobi', 'Mombasa', 'Addis Ababa', 'Cairo', 'Alexandria', 'Casablanca', 'Johannesburg', 'Cape Town', 'Durban', 'Dakar', 'Abidjan', 'Kinshasa', 'Luanda', 'Tunis', 'Algiers',
    'London', 'Manchester', 'Birmingham', 'Edinburgh', 'Dublin', 'Paris', 'Marseille', 'Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Madrid', 'Barcelona', 'Lisbon', 'Rome', 'Milan', 'Naples', 'Amsterdam', 'Brussels', 'Vienna', 'Zurich', 'Geneva', 'Stockholm', 'Copenhagen', 'Oslo', 'Helsinki', 'Warsaw', 'Prague', 'Budapest', 'Athens', 'Istanbul', 'Moscow', 'Kyiv',
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami', 'San Francisco', 'Seattle', 'Boston', 'Washington', 'Las Vegas', 'Toronto', 'Vancouver', 'Montreal', 'Mexico City', 'Havana', 'Bogotá', 'Lima', 'Santiago', 'Buenos Aires', 'São Paulo', 'Rio de Janeiro', 'Caracas',
    'Dubai', 'Abu Dhabi', 'Riyadh', 'Doha', 'Tehran', 'Baghdad', 'Tel Aviv', 'Karachi', 'Lahore', 'Islamabad', 'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bangalore', 'Dhaka', 'Colombo', 'Kathmandu', 'Bangkok', 'Hanoi', 'Jakarta', 'Manila', 'Kuala Lumpur', 'Singapore', 'Hong Kong', 'Shanghai', 'Beijing', 'Shenzhen', 'Taipei', 'Seoul', 'Tokyo', 'Osaka', 'Kyoto', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Auckland', 'Wellington',
    'Nigeria', 'Ghana', 'Kenya', 'Egypt', 'South Africa', 'Morocco', 'Ethiopia', 'Tanzania', 'Uganda', 'Senegal', 'United Kingdom', 'United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'France', 'Germany', 'Spain', 'Italy', 'Portugal', 'Netherlands', 'Sweden', 'Norway', 'Poland', 'Turkey', 'Russia', 'Ukraine', 'India', 'Pakistan', 'Bangladesh', 'China', 'Japan', 'South Korea', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Australia', 'New Zealand', 'Saudi Arabia', 'United Arab Emirates', 'Iran', 'Iraq', 'Israel', 'Ireland', 'Switzerland', 'Greece', 'Austria'];

  const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, '').replace(/\s+/g, ' ').trim();

  /** Levenshtein edit distance (two-row DP). */
  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  /** 0..1 similarity; names that merely start with what was typed count as a good match. */
  function sim(typed, name) {
    const a = norm(typed), b = norm(name);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const s = 1 - lev(a, b) / Math.max(a.length, b.length);
    return b.startsWith(a) ? Math.max(s, .92) : s;
  }

  const searchCache = new Map();
  const geocode = async (name, signal) => {
    const p = new URLSearchParams({ name, count: 8, language: 'en', format: 'json' });
    const json = await fetchJSON(`${API.geo}?${p}`, { signal, timeout: 9000 });
    return json.results || [];
  };
  const toLoc = (r) => ({ id: r.id, name: r.name, admin1: r.admin1 || '', country: r.country || '', countryCode: r.country_code || '', latitude: r.latitude, longitude: r.longitude, population: r.population || 0 });

  /**
   * Resolves what the user typed into ranked locations. When the best result is not a close
   * match, extra "variant" lookups (de-duplicated letters, nearest well-known names, shortened
   * text) are run so a mistyped name still yields sensible alternatives.
   */
  async function findPlaces(raw, signal) {
    const q = raw.trim().replace(/\s+/g, ' ');
    const key = norm(q);
    if (key.length < 2) return { items: [], corrected: false, query: q };
    if (searchCache.has(key)) return searchCache.get(key);

    let pool = await geocode(q, signal);
    if (!pool.some((r) => sim(q, r.name) >= .9)) {
      const variants = new Set();
      const dedup = key.replace(/(.)\1+/g, '$1');
      if (dedup !== key) variants.add(dedup);
      POPULAR.map((n) => [n, sim(q, n)]).filter(([, s]) => s >= .62).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([n]) => variants.add(n));
      if (key.length >= 5) variants.add(key.slice(0, Math.ceil(key.length * .7)));
      if (key.length >= 4) variants.add(key.slice(0, -1));
      variants.delete(key);
      const extra = await Promise.all([...variants].slice(0, 4).map((v) => geocode(v, signal).catch((e) => { if (signal?.aborted) throw e; return []; })));
      pool = pool.concat(...extra);
    }

    const seen = new Set();
    const ranked = pool
      .filter((r) => !seen.has(r.id) && seen.add(r.id))
      .map((r) => {
        const s = sim(q, r.name);
        const popBoost = Math.log10((r.population || 0) + 10) / 8;
        return { r, s, score: s * .75 + popBoost * .25 + (r.feature_code === 'PCLI' ? .04 : 0) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const result = {
      query: q,
      items: ranked.map((x) => toLoc(x.r)),
      corrected: ranked.length > 0 && Math.max(...ranked.map((x) => x.s)) < .9,
    };
    if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(key, result);
    return result;
  }

  /* ---- Suggestion dropdown UI ---- */
  const ui = { items: [], active: -1, open: false, token: 0, ctrl: null, timer: 0 };
  const input = $('#search-input'), panel = $('#suggest-panel'), list = $('#suggestions'), note = $('#suggest-note');

  function openPanel(open) {
    ui.open = open;
    panel.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) { ui.active = -1; input.removeAttribute('aria-activedescendant'); }
  }
  function setNote(html, kind = '') { note.className = `suggest-note ${kind}`.trim(); note.innerHTML = html; }
  function setActive(i) {
    ui.active = i;
    $$('.sg-item', list).forEach((el, k) => {
      el.classList.toggle('active', k === i);
      el.setAttribute('aria-selected', String(k === i));
      if (k === i) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
    if (i < 0) input.removeAttribute('aria-activedescendant');
  }

  function renderItems(items, { badgeFirst = false } = {}) {
    ui.items = items;
    list.innerHTML = items.map((it, i) => {
      const sub = it.action ? 'Allow location access to detect where you are' : [it.admin1 && it.admin1 !== it.name ? it.admin1 : '', it.country].filter(Boolean).join(', ') || 'Country / region';
      const tag = it.action ? '' : (badgeFirst && i === 0 ? '<span class="sg-badge">Best match</span>' : it.countryCode ? `<span class="sg-tag">${esc(it.countryCode)}</span>` : '');
      return `<li class="sg-item" id="sg-${i}" role="option" aria-selected="false" data-i="${i}">
        <span class="sg-pin">${it.action ? LOCATE_SVG : PIN_SVG}</span>
        <span class="sg-text"><span class="sg-name">${esc(it.action ? 'Use my current location' : it.name)}</span><span class="sg-sub">${esc(sub)}</span></span>${tag}
      </li>`;
    }).join('');
    ui.active = -1;
  }

  function showRecents() {
    const recents = store.get(STORE.recent, []).filter(validLoc);
    const items = [{ action: 'locate' }, ...recents];
    setNote(recents.length ? 'Recent searches' : 'Type a city or country — we’ll help with spelling.');
    renderItems(items);
    openPanel(true);
  }

  function showResults(res, { fromSubmit = false } = {}) {
    const safe = esc(res.query);
    if (!res.items.length) {
      renderItems([]);
      setNote(`No places found for <b>“${safe}”</b>. Check the spelling, or try a nearby larger city or the country name.`, 'warn');
      $('#search-status').textContent = `No results for ${res.query}.`;
      openPanel(true);
      return;
    }
    if (res.corrected) {
      setNote(`No exact match for <b>“${safe}”</b>. Did you mean <b>${esc(res.items[0].name)}</b>?`, 'warn');
      renderItems(res.items, { badgeFirst: true });
      $('#search-status').textContent = `No exact match. Did you mean ${res.items[0].name}? ${res.items.length} suggestions available.`;
    } else {
      setNote('');
      renderItems(res.items);
      $('#search-status').textContent = `${res.items.length} suggestion${res.items.length === 1 ? '' : 's'} available.`;
    }
    openPanel(true);
    if (fromSubmit && res.corrected) setActive(0); // second Enter confirms the suggestion
  }

  /** Runs a search; returns null when the request was superseded by a newer one. */
  async function runSearch(q, opts = {}) {
    const token = ++ui.token;
    ui.ctrl?.abort();
    ui.ctrl = new AbortController();
    try {
      const res = await findPlaces(q, ui.ctrl.signal);
      if (token !== ui.token) return null;
      return res;
    } catch (err) {
      if (token !== ui.token || err.name === 'AbortError') return null;
      setNote('Couldn’t reach the location service. Check your connection and try again.', 'error');
      renderItems([]);
      openPanel(true);
      return null;
    }
  }

  function selectPlace(loc) {
    if (!loc) return;
    if (loc.action === 'locate') { openPanel(false); locateMe(); return; }
    clearTimeout(ui.timer); ui.ctrl?.abort(); ui.token++;
    input.value = loc.name;
    syncClear();
    openPanel(false);
    input.blur();
    const recents = [loc, ...store.get(STORE.recent, []).filter((r) => !(r.latitude === loc.latitude && r.longitude === loc.longitude))].slice(0, 5);
    store.set(STORE.recent, recents);
    loadWeather(loc);
  }

  function syncClear() { $('#search-clear').hidden = !input.value; }

  input.addEventListener('input', () => {
    syncClear();
    clearTimeout(ui.timer);
    const q = input.value.trim();
    if (!q) { ui.token++; ui.ctrl?.abort(); showRecents(); return; }
    if (norm(q).length < 2) { openPanel(false); return; }
    ui.timer = setTimeout(async () => {
      const res = await runSearch(q);
      if (res && input.value.trim() === q) showResults(res);
    }, 260);
  });
  input.addEventListener('focus', () => { if (!input.value.trim()) showRecents(); else if (ui.items.length) openPanel(true); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!ui.open) { if (ui.items.length) openPanel(true); return; }
      e.preventDefault();
      const n = ui.items.length;
      if (!n) return;
      setActive(e.key === 'ArrowDown' ? (ui.active + 1) % n : (ui.active - 1 + n) % n);
    } else if (e.key === 'Escape') { openPanel(false); }
  });

  $('#search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ui.open && ui.active >= 0 && ui.items[ui.active]) return selectPlace(ui.items[ui.active]);
    const q = input.value.trim();
    if (!q) { input.focus(); showRecents(); return; }
    clearTimeout(ui.timer);
    setNote('Searching…'); openPanel(true); renderItems([]);
    const res = await runSearch(q);
    if (!res) return;
    if (res.items.length && !res.corrected) selectPlace(res.items[0]); // confident match → go
    else showResults(res, { fromSubmit: true });                       // otherwise offer corrections
  });

  $('#search-clear').addEventListener('click', () => { input.value = ''; syncClear(); input.focus(); showRecents(); });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus while clicking
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.sg-item');
    if (li) selectPlace(ui.items[Number(li.dataset.i)]);
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.sg-item');
    if (li && Number(li.dataset.i) !== ui.active) { ui.active = Number(li.dataset.i); $$('.sg-item', list).forEach((el, k) => el.classList.toggle('active', k === ui.active)); }
  });
  document.addEventListener('pointerdown', (e) => { if (ui.open && !e.target.closest('#search-form')) openPanel(false); });

  /* ---------------------------------------------------------
     11. Geolocation, units, refresh, nav, UI plumbing
     --------------------------------------------------------- */
  function locateMe() {
    if (!('geolocation' in navigator)) return toast('Geolocation isn’t supported by this browser.', 'error');
    const btn = $('#btn-locate');
    setBusy(btn, true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(btn, false);
        loadWeather({ name: 'Your location', admin1: '', country: '', latitude: +pos.coords.latitude.toFixed(4), longitude: +pos.coords.longitude.toFixed(4), isGeo: true });
      },
      (err) => {
        setBusy(btn, false);
        toast(err.code === 1 ? 'Location permission was denied. You can still search for a city.' : err.code === 3 ? 'Finding your location took too long. Please try again.' : 'Your location is unavailable right now.', 'error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function setUnit(unit) {
    state.unit = unit;
    store.set(STORE.unit, unit);
    $$('.unit-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === unit)));
    if (state.data) render();
  }

  function setBusy(btn, busy) { if (!btn) return; btn.classList.toggle('busy', busy); btn.disabled = busy; }
  function showLoader(on) { $('#loader').hidden = !on; }
  function showError(msg) { $('#error-text').textContent = msg; $('#error-banner').hidden = false; }
  function hideError() { $('#error-banner').hidden = true; }

  let toastTimer;
  function toast(msg, kind = 'info', ms = 4200) {
    const el = $('#toast');
    el.textContent = msg; el.className = `toast ${kind}`; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function bindUI() {
    // Header nav (mobile drawer)
    const header = $('#site-header'), toggle = $('#nav-toggle');
    const setNav = (open) => { header.classList.toggle('nav-open', open); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
    toggle.addEventListener('click', () => setNav(!header.classList.contains('nav-open')));
    $$('.nav-link').forEach((a) => a.addEventListener('click', () => setNav(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });
    window.matchMedia('(min-width: 1000px)').addEventListener?.('change', (m) => { if (m.matches) setNav(false); });
    document.addEventListener('pointerdown', (e) => { if (header.classList.contains('nav-open') && !e.target.closest('#header-bar')) setNav(false); });

    // Keep --header-h in sync so anchor links clear the sticky header
    if ('ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);

    // Scroll-spy for nav links
    if ('IntersectionObserver' in window) {
      const links = $$('.nav-link');
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${en.target.id}`)));
        });
      }, { rootMargin: '-35% 0px -55% 0px' });
      ['home', 'forecast', 'about'].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
    }

    // Tools
    $('#btn-locate').addEventListener('click', locateMe);
    $('#btn-refresh').addEventListener('click', () => loadWeather(state.loc));
    $$('.unit-toggle button').forEach((b) => b.addEventListener('click', () => setUnit(b.dataset.unit)));
    $('#error-retry').addEventListener('click', () => loadWeather(state.loc));
    $$('#chart-modes button').forEach((b) => b.addEventListener('click', () => {
      state.chartMode = b.dataset.mode;
      $$('#chart-modes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderChart();
    }));

    // Hourly scroller buttons
    const hl = $('#hourly-list');
    $('#hourly-prev').addEventListener('click', () => hl.scrollBy({ left: -hl.clientWidth * .8, behavior: 'smooth' }));
    $('#hourly-next').addEventListener('click', () => hl.scrollBy({ left: hl.clientWidth * .8, behavior: 'smooth' }));

    // Re-draw the chart when its container width changes (rotation, resize)
    const wrap = $('#chart-wrap');
    if ('ResizeObserver' in window) {
      let raf = 0;
      new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { if (state.data && Math.floor(wrap.clientWidth) !== Number(wrap.dataset.w)) renderChart(); });
      }).observe(wrap);
    }
    window.addEventListener('online', () => { if (!state.data) loadWeather(state.loc); });
  }

  /* ---------------------------------------------------------
     12. Boot
     --------------------------------------------------------- */
  function init() {
    buildStars();
    bindUI();
    setUnit(state.unit);
    tick();
    setInterval(tick, 1000);
    loadWeather(state.loc);
    // Automatic background refresh
    setInterval(() => { if (!document.hidden) loadWeather(state.loc, { silent: true }); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.lastUpdated && Date.now() - state.lastUpdated > REFRESH_MS) loadWeather(state.loc, { silent: true });
    });
  }

  init();
})();
