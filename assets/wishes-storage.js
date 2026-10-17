(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DaiviWishes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function publicKeyAllowed(key) {
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return key.split('.').length === 3 && JSON.parse(atob(payload)).role === 'anon';
    } catch { return false; }
  }

  function normalizeEntry(entry) {
    return { id: entry.id, name: entry.name, attendance: entry.attendance, message: entry.message, createdAt: entry.created_at };
  }

  function createStorage(config = {}, { fetch: request = globalThis.fetch, location = globalThis.location } = {}) {
    const key = (config.supabasePublishableKey || '').trim();
    const project = (config.supabaseUrl || '').trim();
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location?.hostname);
    const wantsOnline = config.storage === 'supabase' || Boolean(project || key);
    let endpoint;
    if (wantsOnline) {
      try {
        const url = new URL(project);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || !publicKeyAllowed(key)) throw new Error();
        endpoint = new URL('/rest/v1/ucapan', url.origin);
      } catch { /* Konfigurasi yang belum lengkap tidak dikirim ke jaringan. */ }
    }
    const mode = endpoint ? 'supabase' : !wantsOnline && (config.storage === 'local' || (local && /^https?:$/.test(location?.protocol))) ? 'local' : 'unconfigured';
    const unavailable = 'Kolom ucapan belum tersedia. Silakan kembali lagi nanti.';

    async function fetchResponse(url, options) {
      try { return await request(url, options); }
      catch { throw new Error('Layanan ucapan belum dapat dihubungi. Silakan coba kembali.'); }
    }

    async function readLocal(response) {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ucapan belum dapat diproses. Silakan coba kembali.');
      return data;
    }

    function headers(prefer) {
      // Publishable keys bukan JWT: kirim melalui apikey, tanpa Bearer token.
      return { apikey: key, 'Content-Type': 'application/json', Prefer: prefer };
    }

    async function list(page = 1, adjusted = false) {
      if (mode === 'unconfigured') throw new Error(unavailable);
      page = Number.isSafeInteger(page) && page > 0 ? page : 1;
      if (mode === 'local') return readLocal(await fetchResponse('/api/ucapan?page=' + page, { cache: 'no-store' }));
      const url = new URL(endpoint);
      url.searchParams.set('select', 'id,name,attendance,message,created_at');
      url.searchParams.set('order', 'created_at.desc,id.desc');
      url.searchParams.set('limit', '10');
      url.searchParams.set('offset', String((page - 1) * 10));
      const response = await fetchResponse(url.href, { headers: headers('count=exact'), cache: 'no-store', credentials: 'omit' });
      const range = response.headers.get('content-range') || '';
      const match = /\/(\d+)$/.exec(range);
      const total = match ? Number(match[1]) : null;
      const pages = total === null ? 1 : Math.max(1, Math.ceil(total / 10));
      if (page > pages && !adjusted && total !== null) return list(pages, true);
      if (!response.ok) throw new Error('Ucapan belum dapat dimuat. Silakan coba kembali.');
      const data = await response.json();
      if (!Array.isArray(data) || !Number.isSafeInteger(total)) throw new Error('Ucapan belum dapat dimuat. Silakan coba kembali.');
      return { entries: data.map(normalizeEntry), total, page: Math.min(page, pages), pages };
    }

    async function send(input) {
      if (mode === 'unconfigured') throw new Error(unavailable);
      if (!input.name?.trim() || input.name.trim().length > 150 || !input.message?.trim() || input.message.trim().length > 300 || !['hadir', 'tidak_hadir', 'ragu'].includes(input.attendance)) {
        throw new Error('Lengkapi nama, kehadiran, dan ucapan maksimal 300 karakter.');
      }
      const body = JSON.stringify({ name: input.name.trim(), attendance: input.attendance, message: input.message.trim() });
      if (mode === 'local') return readLocal(await fetchResponse('/api/ucapan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
      const response = await fetchResponse(endpoint.href, {
        method: 'POST', headers: headers('return=representation'), body, credentials: 'omit',
      });
      if (!response.ok) throw new Error('Ucapan belum dapat disimpan. Silakan coba kembali.');
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows[0]?.id) throw new Error('Ucapan belum dapat dikonfirmasi. Muat ulang daftar ucapan terlebih dahulu.');
      // Jumlah keseluruhan dibaca terpisah; kegagalan refresh tidak membatalkan kiriman.
      return { entry: normalizeEntry(rows[0]), total: null };
    }

    return { mode, configured: mode !== 'unconfigured', list, send };
  }

  return { createStorage };
});
