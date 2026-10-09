/* Maceda Lighting — privacy-limited, first-touch campaign attribution.
   Reads existing URL campaign parameters. Never generates/rewrites QR codes,
   and never collects names, phone numbers, emails, full referrer paths or cookies. */
(function () {
  'use strict';
  const KEY = 'maceda_first_touch_v1';
  const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const SAFE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  const PAGES = new Set(['/', '/visualizer/', '/privacy', '/terms']);
  function safe(value) {
    return typeof value === 'string' && SAFE.test(value) && !/[0-9]{7}/.test(value) ? value : null;
  }
  function origin(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin.length <= 200 ? url.origin : null;
    } catch { return null; }
  }
  function collect() {
    const params = new URLSearchParams(location.search);
    const data = { version: 1, landing_page: PAGES.has(location.pathname) ? location.pathname : '/', first_touch_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    for (const field of FIELDS) {
      const value = safe(params.get(field));
      if (value) data[field] = value;
    }
    const ref = origin(document.referrer);
    if (ref && ref !== location.origin) data.referrer = ref;
    return data;
  }
  let first;
  try {
    first = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!first || first.version !== 1) {
      first = collect();
      sessionStorage.setItem(KEY, JSON.stringify(first));
    }
  } catch { first = collect(); }
  window.MacedaAttribution = Object.freeze({
    get: function () { return Object.assign({}, first); }
  });
})();
