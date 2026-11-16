(() => {
'use strict';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const view = $('#view');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fans(n) {
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M fans';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K fans';
  return n + ' fans';
}

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
};
const K = {
  saved: 'sidetrack.saved.v1', trail: 'sidetrack.trail.v1', graph: 'sidetrack.graph.v1',
  spotify: 'sidetrack.spotify.v1', pkce: 'sidetrack.spotify.pkce', prefs: 'sidetrack.prefs.v1',
};

/* ================= icons ================= */
const svg = (name, body) => `<svg class="i i-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICONS = {
  play: svg('play', '<path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"/>'),
  pause: svg('pause', '<rect fill="currentColor" x="6" y="5" width="4.5" height="14" rx="1.2"/><rect fill="currentColor" x="13.5" y="5" width="4.5" height="14" rx="1.2"/>'),
  next: svg('next', '<path fill="currentColor" d="M5 5.9v12.2a1 1 0 0 0 1.55.83L15 13.3V18a1.25 1.25 0 0 0 2.5 0V6A1.25 1.25 0 0 0 15 6v4.7L6.55 5.07A1 1 0 0 0 5 5.9z"/>'),
  heart: svg('heart', '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M12 20.3s-7.6-4.5-7.6-10.2a4.2 4.2 0 0 1 7.6-2.5 4.2 4.2 0 0 1 7.6 2.5c0 5.7-7.6 10.2-7.6 10.2z"/>'),
  search: svg('search', '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  ext: svg('ext', '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M14 5h5v5M19 5l-8 8M11 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4"/>'),
  artist: svg('artist', '<circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.800 1.600 7 4.800"/>'),
  blend: svg('blend', '<circle cx="9" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="15" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.9"/>'),
  x: svg('x', '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>'),
  copy: svg('copy', '<rect x="9" y="9" width="10" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M15 6V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>'),
  more: svg('more', '<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>'),
  check: svg('check', '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/>'),
  plus: svg('plus', '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 5v14M5 12h14"/>'),
  install: svg('install','<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>'),
};
const ic = name => ICONS[name];
const PLAYSTATE = ic('play') + ic('pause') + '<span class="spin"></span>';

/* ================= music data (Deezer public API, via JSONP) ================= */
let cbSeq = 0;
function jsonp(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const name = '__sidetrack_cb' + (++cbSeq);
    const script = document.createElement('script');
    const netErr = () => Object.assign(new Error('network'), { network: true });
    const timer = setTimeout(() => { window[name] = () => { delete window[name]; }; script.remove(); reject(netErr()); }, timeout);
    window[name] = data => { clearTimeout(timer); delete window[name]; script.remove(); resolve(data); };
    script.onerror = () => { clearTimeout(timer); delete window[name]; script.remove(); reject(netErr()); };
    script.src = url + '&callback=' + name;
    document.head.appendChild(script);
  });
}

const MAX_PARALLEL = 6;
let active = 0;
const waiting = [];
const takeSlot = () => new Promise(res => { const go = () => { active++; res(); }; active < MAX_PARALLEL ? go() : waiting.push(go); });
const freeSlot = () => { active--; const n = waiting.shift(); if (n) n(); };

async function request(path, params) {
  await takeSlot();
  try {
    for (let attempt = 0; ; attempt++) {
      const qs = new URLSearchParams({ ...params, output: 'jsonp' });
      const res = await jsonp(`https://api.deezer.com/${path}?${qs}`);
      if (res && res.error) {
        if (res.error.code === 4 && attempt < 3) { await sleep(1200); continue; } // rate limited, wait and retry
        throw Object.assign(new Error(res.error.message || 'Request failed'), { api: res.error });
      }
      return res;
    }
  } finally { freeSlot(); }
}

const cache = new Map();
function dz(path, params = {}, { fresh = false } = {}) {
  const key = path + '?' + new URLSearchParams(params);
  if (!fresh && cache.has(key)) return cache.get(key);
  const p = request(path, params);
  if (!fresh) { cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
}

const slimArtist = a => ({
  id: a.id,
  name: a.name,
  pic: a.picture_medium || a.pic || '',
  picBig: a.picture_big || a.picBig || a.picture_medium || a.pic || '',
  fans: a.nb_fan ?? a.fans ?? 0,
});
const normTrack = t => ({
  id: t.id,
  title: t.title,
  artist: { id: t.artist.id, name: t.artist.name },
  album: t.album ? t.album.title : '',
  cover: t.album ? t.album.cover_medium : '',
  coverBig: t.album ? t.album.cover_big : '',
  preview: t.preview || '',
  link: t.link || 'https://www.deezer.com/track/' + t.id,
  at: Date.now(),
});
const related = id => dz(`artist/${id}/related`, { limit: 30 }).then(r => (r.data || []).map(slimArtist));

/* ================= state ================= */
let saved = store.get(K.saved, { tracks: [], artists: [] });
let trail = store.get(K.trail, []);
let graph = store.get(K.graph, { nodes: {}, edges: [] });
const relIds = new Map();        // artist id -> Set of related ids (this session)
const knownTracks = new Map();
const knownArtists = new Map();
const lists = new Map();         // list id -> queue items, referenced by play buttons
let listSeq = 0;
let current = null;              // what the artist page is showing
let routeName = '';
let hopAt = 0;
let pickerBase = null;

const reg = items => { const id = 'L' + (++listSeq); lists.set(id, items); return id; };
const isTrackSaved = id => saved.tracks.some(t => t.id === id);
const isArtistSaved = id => saved.artists.some(a => a.id === id);
const persistSaved = () => { store.set(K.saved, saved); updateSavedCount(); };

function updateSavedCount() {
  const n = saved.tracks.length + saved.artists.length;
  const b = $('#savedCount');
  b.textContent = n; b.hidden = !n;
}

/* ================= templates ================= */
function artistCard(a, listId, i, { hop = false, tag = '', removable = false } = {}) {
  knownArtists.set(a.id, a);
  return `<div class="card" data-aid="${a.id}">
    <a class="card__link" href="#/artist/${a.id}"${hop ? ' data-hop' : ''}>
      <span class="card__img"><img src="${esc(a.pic)}" alt="" loading="lazy" width="250" height="250"></span>
      <span class="card__name">${esc(a.name)}</span>
      <span class="card__sub">${esc(tag || fans(a.fans))}</span>
    </a>
    <button class="card__play" type="button" data-action="play-artist" data-list="${listId}" data-i="${i}" aria-label="Play a snippet by ${esc(a.name)}">${PLAYSTATE}</button>
    ${removable ? `<button class="card__remove" type="button" data-action="save-artist" data-id="${a.id}" aria-label="Remove ${esc(a.name)} from saved">${ic('x')}</button>` : ''}
  </div>`;
}

function trackRow(t, listId, i, { savedView = false } = {}) {
  knownTracks.set(t.id, t);
  const playable = savedView || !!t.preview;
  const sub = savedView
    ? t.artist.name + (t.via && t.via.length ? ' · via ' + t.via.join(' → ') : '')
    : (t.album || t.artist.name);
  return `<li class="track" data-tid="${t.id}">
    <button class="track__main" type="button" data-action="play-track" data-list="${listId}" data-i="${i}"${playable ? '' : ' disabled title="No snippet available"'}>
      <span class="track__art"><img src="${esc(t.cover)}" alt="" loading="lazy" width="48" height="48"><span class="track__state">${PLAYSTATE}</span></span>
      <span class="track__text"><span class="track__title">${esc(t.title)}</span><span class="track__sub">${esc(sub)}</span></span>
    </button>
    <button class="iconbtn" type="button" data-action="song-menu" data-id="${t.id}" aria-label="Links and options for ${esc(t.title)}" title="Spotify, Apple Music and more">${ic('more')}</button>
    <button class="iconbtn heart" type="button" data-action="save-track" data-id="${t.id}" aria-pressed="${isTrackSaved(t.id)}" aria-label="Save ${esc(t.title)}">${ic('heart')}</button>
  </li>`;
}

function trailHTML(currentId) {
  return `<nav class="trail" aria-label="Your trail"><span class="trail__label">Trail</span><ol>${trail.map(a =>
    `<li><a class="stop${a.id === currentId ? ' is-current' : ''}" href="#/artist/${a.id}"${a.id === currentId ? ' aria-current="page"' : ''}><img src="${esc(a.pic)}" alt="" width="28" height="28"><span>${esc(a.name)}</span></a></li>`
  ).join('')}</ol></nav>`;
}

const skeletonCards = n => Array.from({ length: n }, () => '<div class="card skel"><span class="card__link"><span class="card__img"></span><span class="skel-line"></span></span></div>').join('');

/* ================= toast ================= */
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).onclick = () => { el.hidden = true; action.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2600);
}

/* ================= player ================= */
const audio = new Audio();
audio.preload = 'auto';
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const PREVIEW_TTL = 10 * 60 * 1000; // preview links expire after ~15 minutes
const P = { queue: [], i: -1, track: null, pending: null, loading: false, seq: 0, live: false, unlocked: false, fails: 0 };
const el = { player: $('#player'), art: $('#pArt'), title: $('#pTitle'), artist: $('#pArtist'), save: $('#pSave'), toggle: $('#pToggle'), next: $('#pNext'), bar: $('#pBar') };
el.save.innerHTML = ic('heart');
el.toggle.innerHTML = PLAYSTATE;
el.next.innerHTML = ic('next');
$('[data-action="close-picker"]').innerHTML = ic('x');

// Phones only allow sound that starts inside a tap. Starting a silent clip in the tap keeps later, delayed plays allowed.
function unlock() {
  if (P.unlocked) return;
  P.unlocked = true;
  P.live = false;
  try { audio.src = SILENCE; const p = audio.play(); if (p) p.catch(() => {}); } catch { /* ignore */ }
}

async function freshen(t, force) {
  if (!force && t.preview && Date.now() - (t.at || 0) < PREVIEW_TTL) return t;
  const r = await dz('track/' + t.id, {}, { fresh: true });
  t.preview = r.preview || '';
  t.at = Date.now();
  if (r.isrc) t.isrc = r.isrc;
  const s = saved.tracks.find(x => x.id === t.id);
  if (s) { s.preview = t.preview; s.at = t.at; store.set(K.saved, saved); }
  if (!t.preview) throw new Error('no-preview');
  return t;
}

async function resolveItem(item) {
  if (item.track) return item.track;
  const top = await dz(`artist/${item.artist.id}/top`, { limit: 5 });
  const t = (top.data || []).map(normTrack).find(x => x.preview);
  if (!t) throw new Error('no-preview');
  knownTracks.set(t.id, t);
  item.track = t;
  return t;
}

function startQueue(items, i) {
  unlock();
  P.queue = items;
  P.fails = 0;
  playAt(i);
}

async function playAt(i) {
  if (i < 0 || i >= P.queue.length) return;
  const seq = ++P.seq;
  const item = P.queue[i];
  P.i = i;
  P.live = false;
  audio.pause();
  P.loading = true;
  P.track = item.track || null;
  P.pending = item.artist || null;
  el.bar.style.setProperty('--p', '0%');
  renderPlayer();
  try {
    const t = await resolveItem(item);
    await freshen(t);
    if (seq !== P.seq) return;
    P.track = t;
    renderPlayer();
    await load(t, seq);
  } catch (e) {
    if (seq !== P.seq) return;
    failed(e);
  }
}

async function load(t, seq, retried) {
  P.live = true;
  audio.src = t.preview;
  mediaSession(t);
  try {
    await audio.play();
    P.fails = 0;
  } catch (e) {
    if (seq !== P.seq || e.name === 'AbortError') return;
    if (e.name === 'NotAllowedError') { P.loading = false; renderPlayer(); return; }
    if (retried) throw e;
    await freshen(t, true); // the link may have expired, get a new one and try once more
    if (seq !== P.seq) return;
    await load(t, seq, true);
  }
}

function failed(e) {
  P.loading = false;
  P.live = false;
  if (e && e.network) { renderPlayer(); toast('Can’t reach the music right now. Check your connection.'); return; }
  P.fails++;
  if (P.fails <= 4 && P.i + 1 < P.queue.length) { toast('No snippet for that one, skipping ahead.'); playAt(P.i + 1); return; }
  renderPlayer();
  toast('No snippet available for that one.');
}

function next() {
  if (P.i + 1 < P.queue.length) playAt(P.i + 1);
  else { audio.pause(); P.loading = false; renderPlayer(); }
}
function prev() {
  if (audio.currentTime > 3 || P.i === 0) { audio.currentTime = 0; return; }
  playAt(P.i - 1);
}
function toggle() {
  if (!P.track) return;
  if (P.loading) return;
  if (!audio.paused) { audio.pause(); return; }
  if (audio.ended || audio.error || !P.live) { playAt(P.i); return; }
  audio.play().catch(() => playAt(P.i));
}

audio.addEventListener('playing', () => { if (!P.live) return; P.loading = false; renderPlayer(); });
audio.addEventListener('pause', () => renderPlayer());
audio.addEventListener('ended', () => { if (P.live) next(); });
audio.addEventListener('timeupdate', () => {
  if (!P.live) return;
  const d = audio.duration && isFinite(audio.duration) ? audio.duration : 30;
  el.bar.style.setProperty('--p', Math.min(100, audio.currentTime / d * 100) + '%');
});

function renderPlayer() {
  const t = P.track, a = P.pending;
  const shown = !!(t || a);
  el.player.hidden = !shown;
  document.body.classList.toggle('has-player', shown);
  if (shown) {
    el.title.textContent = t ? t.title : 'Finding a song…';
    el.artist.textContent = t ? t.artist.name : a.name;
    el.artist.dataset.id = t ? t.artist.id : a.id;
    const art = t ? t.cover : a.pic;
    if (el.art.getAttribute('src') !== art) el.art.src = art;
    el.save.disabled = !t;
    el.save.setAttribute('aria-pressed', !!t && isTrackSaved(t.id));
    el.next.disabled = P.i + 1 >= P.queue.length;
  }
  syncPlaying();
}

function syncPlaying() {
  const playing = !!P.track && P.live && !audio.paused && !P.loading;
  const tid = P.track ? P.track.id : null;
  const aid = P.track ? P.track.artist.id : (P.pending ? P.pending.id : null);
  const mark = (node, on) => {
    node.classList.toggle('is-current', on);
    node.classList.toggle('is-playing', on && playing);
    node.classList.toggle('is-loading', on && P.loading);
  };
  $$('.track[data-tid]').forEach(n => mark(n, tid !== null && +n.dataset.tid === tid));
  $$('.card[data-aid]').forEach(n => mark(n, aid !== null && +n.dataset.aid === aid));
  el.player.classList.toggle('is-playing', playing);
  el.player.classList.toggle('is-loading', P.loading);
}

function mediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist.name, album: t.album || '',
      artwork: t.coverBig ? [{ src: t.coverBig, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
  } catch { /* not supported */ }
}
if ('mediaSession' in navigator) {
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* not supported */ } };
  set('play', toggle); set('pause', toggle); set('nexttrack', next); set('previoustrack', prev);
}

/* ================= saving ================= */
function viaNames(artistId) {
  const i = trail.findIndex(a => a.id === artistId);
  const names = (i >= 0 ? trail.slice(0, i) : trail).map(a => a.name);
  return names.slice(-4);
}

function toggleSaveTrack(t) {
  const i = saved.tracks.findIndex(x => x.id === t.id);
  if (i >= 0) {
    const [gone] = saved.tracks.splice(i, 1);
    toast('Removed from saved', { label: 'Undo', run: () => { saved.tracks.splice(i, 0, gone); afterSaveChange(); } });
  } else {
    const copy = { ...t, savedAt: Date.now(), via: viaNames(t.artist.id) };
    saved.tracks.unshift(copy);
    toast('Saved for later');
    autoLike(copy);
  }
  afterSaveChange();
}

function toggleSaveArtist(a) {
  const i = saved.artists.findIndex(x => x.id === a.id);
  if (i >= 0) {
    const [gone] = saved.artists.splice(i, 1);
    toast('Removed from saved', { label: 'Undo', run: () => { saved.artists.splice(i, 0, gone); afterSaveChange(); } });
  } else {
    saved.artists.unshift({ ...slimArtist(a), savedAt: Date.now(), via: viaNames(a.id) });
    toast('Artist saved');
  }
  afterSaveChange();
}

function afterSaveChange() {
  persistSaved();
  $$('[data-action="save-track"]').forEach(b => {
    const on = isTrackSaved(+b.dataset.id);
    b.setAttribute('aria-pressed', on);
    const label = $('span', b); if (label) label.textContent = on ? 'Saved' : 'Save for later';
  });
  if (routeName === 'saved') { renderRoute(); return; }
  $$('.btn[data-action="save-artist"]').forEach(b => {
    const on = isArtistSaved(+b.dataset.id);
    b.setAttribute('aria-pressed', on);
    const label = $('span', b); if (label) label.textContent = on ? 'Saved' : 'Save artist';
  });
  renderPlayer();
}

/* ================= Spotify + Apple Music ================= */
// The client ID comes from the Spotify developer dashboard. It is not a secret: sign-in uses PKCE, which needs no password or key in the page.
const SPOTIFY_CLIENT_ID = '45c7a67141d948eb89815b97d4e5f4ec';
const SP_SCOPES = 'user-library-modify user-library-read';
let sp = store.get(K.spotify, null);            // { access, refresh, exp, name }
let prefs = store.get(K.prefs, { autoLike: true });
let startupToast = '';

const spRedirect = () => location.origin + location.pathname.replace(/index\.html$/, '');
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); };

async function spConnect() {
  if (!SPOTIFY_CLIENT_ID) { toast('Spotify sign-in hasn’t been set up for Sidetrack yet.'); return; }
  if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1') { toast('Spotify sign-in only works on the live site.'); return; }
  const verifier = randomString(64), state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set(K.pkce, { verifier, state, back: location.hash || '#/saved' });
  location.assign('https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: spRedirect(),
    code_challenge_method: 'S256', code_challenge: challenge, state, scope: SP_SCOPES,
  }));
}

async function spToken(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  });
  if (!r.ok) throw Object.assign(new Error('spotify-token'), { status: r.status });
  return r.json();
}

function spStore(t) {
  sp = { access: t.access_token, refresh: t.refresh_token || (sp && sp.refresh), exp: Date.now() + (t.expires_in - 60) * 1000, name: (sp && sp.name) || '' };
  store.set(K.spotify, sp);
}

function spDisconnect() {
  sp = null;
  try { localStorage.removeItem(K.spotify); } catch { /* ignore */ }
}

// Runs once on load: Spotify sends the person back here with ?code=… after they approve.
async function spFinishSignIn() {
  const qs = new URLSearchParams(location.search);
  if (!qs.has('code') && !qs.has('error')) return;
  const stash = store.get(K.pkce, null);
  try { localStorage.removeItem(K.pkce); } catch { /* ignore */ }
  const back = (stash && stash.back) || '#/saved';
  if (qs.has('code') && stash && stash.state === qs.get('state')) {
    try {
      spStore(await spToken({
        grant_type: 'authorization_code', code: qs.get('code'), redirect_uri: spRedirect(),
        client_id: SPOTIFY_CLIENT_ID, code_verifier: stash.verifier,
      }));
      try { const me = await spApi('GET', 'me'); sp.name = (me && (me.display_name || me.id)) || ''; store.set(K.spotify, sp); } catch { /* name is optional */ }
      startupToast = 'Spotify connected';
    } catch { startupToast = 'Spotify sign-in didn’t complete. Try again.'; }
  } else {
    startupToast = 'Spotify sign-in was cancelled.';
  }
  history.replaceState(null, '', location.pathname + back);
}

let refreshing = null;
async function spAccess() {
  if (!sp) throw Object.assign(new Error('not-connected'), { status: 0 });
  if (Date.now() < sp.exp) return sp.access;
  if (!refreshing) {
    refreshing = spToken({ grant_type: 'refresh_token', refresh_token: sp.refresh, client_id: SPOTIFY_CLIENT_ID })
      .then(spStore)
      .catch(e => { if (e.status === 400 || e.status === 401) spDisconnect(); throw e; })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  return sp.access;
}

async function spApi(method, path, params) {
  const token = await spAccess();
  const r = await fetch('https://api.spotify.com/v1/' + path + (params ? '?' + new URLSearchParams(params) : ''), {
    method, headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 401) spDisconnect();
  if (!r.ok) throw Object.assign(new Error('spotify'), { status: r.status });
  const text = await r.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function spError(e) {
  const s = e && e.status;
  if (s === 403) return 'Spotify refused. The Spotify app’s owner needs Premium, and your account must be on its user list.';
  if (s === 401 || s === 400 || s === 0) return 'Spotify needs you to connect again.';
  if (s === 429) return 'Spotify is busy. Try again in a moment.';
  return 'Couldn’t reach Spotify.';
}

const cleanTitle = title => String(title).replace(/\s*[([].*?[)\]]/g, '').replace(/\s-\s.*$/, '').trim() || String(title);
const norm = s => {
  const n = cleanTitle(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return n || String(s).toLowerCase().trim();
};

// Remember what we learn about a song (its Spotify id, Apple link) on the saved copy too.
function remember(t) {
  const s = saved.tracks.find(x => x.id === t.id);
  if (!s) return;
  if (s !== t) for (const k of ['isrc', 'spotifyId', 'appleUrl', 'liked']) if (t[k] !== undefined) s[k] = t[k];
  store.set(K.saved, saved);
}

async function spFind(t) {
  if (t.spotifyId !== undefined) return t.spotifyId;
  if (t.isrc === undefined) {
    try { t.isrc = (await dz('track/' + t.id)).isrc || ''; } catch { /* fall back to a name search */ }
  }
  let item = null;
  if (t.isrc) {
    const r = await spApi('GET', 'search', { q: 'isrc:' + t.isrc, type: 'track', limit: 1 });
    item = r && r.tracks && r.tracks.items[0];
  }
  if (!item) {
    const r = await spApi('GET', 'search', { q: `track:${cleanTitle(t.title)} artist:${t.artist.name}`, type: 'track', limit: 1 });
    item = r && r.tracks && r.tracks.items[0];
  }
  t.spotifyId = item ? item.id : '';
  remember(t);
  return t.spotifyId;
}

async function spLike(t) {
  const id = await spFind(t);
  if (!id) return 'missing';
  await spApi('PUT', 'me/library', { uris: 'spotify:track:' + id });
  t.liked = true;
  remember(t);
  return 'ok';
}

function autoLike(t) {
  if (!sp || !prefs.autoLike) return;
  spLike(t)
    .then(res => {
      if (sheetTrack && sheetTrack.id === t.id) { sheetTrack.liked = t.liked; sheetTrack.spotifyId = t.spotifyId; renderSheet(); }
      toast(res === 'ok' ? 'Saved, and added to your Spotify Liked Songs' : 'Saved here. Couldn’t find it on Spotify.');
    })
    .catch(e => { toast('Saved here. ' + spError(e)); if (routeName === 'saved' && !sp) renderRoute(); });
}

async function spLikeAll() {
  const todo = saved.tracks.slice();
  if (!todo.length) return;
  toast(`Matching ${todo.length} song${todo.length === 1 ? '' : 's'} on Spotify…`);
  const uris = [];
  let missing = 0;
  try {
    for (const t of todo) {
      const id = await spFind(t);
      if (id) uris.push('spotify:track:' + id); else missing++;
    }
    for (let i = 0; i < uris.length; i += 40) await spApi('PUT', 'me/library', { uris: uris.slice(i, i + 40).join(',') });
  } catch (e) {
    toast(spError(e));
    if (routeName === 'saved' && !sp) renderRoute();
    return;
  }
  todo.forEach(t => { if (t.spotifyId) t.liked = true; });
  store.set(K.saved, saved);
  toast(`Added ${uris.length} to your Liked Songs` + (missing ? `, ${missing} not found on Spotify` : ''));
}

async function appleFind(t) {
  if (t.appleUrl !== undefined) return t.appleUrl;
  const term = `${t.artist.name} ${cleanTitle(t.title)}`;
  const country = ((navigator.language || '').split('-')[1] || 'us').toLowerCase();
  const run = async (c, query) => {
    const r = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ entity: 'song', limit: '25', country: c, ...query }));
    if (!r.ok) throw new Error('itunes');
    return (await r.json()).results || [];
  };
  let results, store_ = country;
  try { results = await run(country, { term }); }
  catch (e) { if (country === 'us') throw e; store_ = 'us'; results = await run('us', { term }); }
  // Prefer the same recording: an identical title beats one that only matches once "(Live)", "(Acoustic)" and the like are stripped.
  const wantArtist = norm(t.artist.name), wantTitle = norm(t.title);
  const plain = s => String(s).toLowerCase().trim();
  const hasVersion = s => /[([]|\s-\s/.test(s);
  const pick = list => {
    let found = null, top = 0;
    for (const r of list) {
      const name = r.trackName || '';
      const a = norm(r.artistName || ''), n = norm(name);
      if (!(a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a))) continue;
      let score = 0;
      if (plain(name) === plain(t.title)) score = 4;
      else if (n === wantTitle) score = hasVersion(name) && !hasVersion(t.title) ? 1 : 3;
      if (score > top) { found = r; top = score; }
    }
    return top >= 3 ? found : null; // a different version is worse than honest search results
  };
  let best = pick(results);
  if (!best) { // second try: search by song title alone, then filter to the artist
    try { best = pick(await run(store_, { term: cleanTitle(t.title), attribute: 'songTerm', limit: '50' })); } catch { /* keep the search link */ }
  }
  t.appleUrl = best && best.trackViewUrl ? best.trackViewUrl.replace(/&uo=\d+/, '') : '';
  remember(t);
  return t.appleUrl;
}

/* ---------- the song sheet: save, like, and open elsewhere ---------- */
const sheet = $('#sheet');
let sheetTrack = null;
let sheetSeq = 0;
let sheetBusy = false;

function renderSheet() {
  const t = sheetTrack;
  if (!t) return;
  const q = encodeURIComponent(`${t.artist.name} ${cleanTitle(t.title)}`);
  const spotifyUrl = t.spotifyId ? 'https://open.spotify.com/track/' + t.spotifyId : 'https://open.spotify.com/search/' + q;
  const appleUrl = t.appleUrl || 'https://music.apple.com/search?term=' + q;
  const hint = (exact, pending) => exact ? 'Exact song' : pending ? 'Finding it…' : 'Search';
  const savedNow = isTrackSaved(t.id);
  const likeBtn = !sp
    ? `<button class="btn" type="button" data-action="sp-connect">Connect Spotify to add to Liked Songs</button>`
    : t.liked
      ? `<button class="btn btn--primary" type="button" disabled>${ic('check')} In your Spotify Liked Songs</button>`
      : `<button class="btn btn--primary" type="button" data-action="sp-like">${ic('plus')} Add to Spotify Liked Songs</button>`;
  sheet.innerHTML = `
    <div class="sheet__head">
      <img src="${esc(t.coverBig || t.cover)}" alt="" width="64" height="64">
      <div><strong>${esc(t.title)}</strong><span>${esc(t.artist.name)}</span></div>
      <button class="iconbtn" type="button" data-action="close-sheet" aria-label="Close">${ic('x')}</button>
    </div>
    <div class="sheet__actions">
      ${likeBtn}
      <button class="btn" type="button" data-action="save-track" data-id="${t.id}" aria-pressed="${savedNow}">${ic('heart')}<span>${savedNow ? 'Saved' : 'Save for later'}</span></button>
    </div>
    <p class="eyebrow">Open the full song in</p>
    <div class="sheet__links">
      <a class="svc" href="${esc(spotifyUrl)}" target="_blank" rel="noopener"><b>Spotify</b><small>${hint(!!t.spotifyId, sheetBusy && !!sp)}</small></a>
      <a class="svc" href="${esc(appleUrl)}" target="_blank" rel="noopener"><b>Apple Music</b><small>${hint(!!t.appleUrl, sheetBusy)}</small></a>
      <a class="svc" href="${esc(t.link)}" target="_blank" rel="noopener"><b>Deezer</b><small>Exact song</small></a>
    </div>
    <a class="link" href="#/artist/${t.artist.id}" data-action="close-sheet">Go to ${esc(t.artist.name)}</a>`;
}

function openSheet(t) {
  knownTracks.set(t.id, t);
  sheetTrack = t;
  const seq = ++sheetSeq;
  sheetBusy = true;
  renderSheet();
  if (!sheet.open) { if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', ''); }
  const jobs = [appleFind(t).catch(() => {})];
  if (sp) {
    jobs.push(spFind(t)
      .then(id => id ? spApi('GET', 'me/library/contains', { uris: 'spotify:track:' + id }) : null)
      .then(r => { if (r) t.liked = !!r[0]; })
      .catch(() => {}));
  }
  Promise.all(jobs).then(() => {
    if (seq !== sheetSeq) return;
    sheetBusy = false;
    if (sheet.open) renderSheet();
  });
}
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

/* ================= trail + map data ================= */
function updateTrail(a, hop) {
  const i = trail.findIndex(t => t.id === a.id);
  const last = trail[trail.length - 1];
  if (i >= 0) { trail = trail.slice(0, i + 1); trail[i] = a; }
  else if (last && (hop || (relIds.get(last.id) && relIds.get(last.id).has(a.id)))) trail.push(a);
  else trail = [a];
  if (trail.length > 12) trail = trail.slice(-12);
  store.set(K.trail, trail);
}

function recordGraph(artist, rel) {
  const touch = (a, visited) => {
    const n = graph.nodes[a.id] || (graph.nodes[a.id] = { id: a.id, v: 0 });
    n.name = a.name; n.pic = a.pic;
    if (visited) { n.v = 1; n.t = Date.now(); }
  };
  const link = (a, b, hop) => {
    const e = graph.edges.find(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a));
    if (e) { if (hop) e[2] = 1; } else graph.edges.push([a, b, hop ? 1 : 0]);
  };
  touch(artist, true);
  const n = trail.length;
  if (n > 1 && trail[n - 1].id === artist.id) link(trail[n - 2].id, artist.id, true);
  rel.slice(0, 5).forEach(r => { touch(r, false); link(artist.id, r.id, false); });

  // keep the map readable: the 14 most recent stops and their neighbours
  const keep = new Set(Object.values(graph.nodes).filter(x => x.v).sort((x, y) => y.t - x.t).slice(0, 14).map(x => x.id));
  graph.edges = graph.edges.filter(e => keep.has(e[0]) || keep.has(e[1]));
  const linked = new Set();
  graph.edges.forEach(e => { linked.add(e[0]); linked.add(e[1]); });
  for (const key of Object.keys(graph.nodes)) {
    const node = graph.nodes[key];
    if (node.v && !keep.has(node.id)) node.v = 0;
    if (!linked.has(node.id) && !keep.has(node.id)) delete graph.nodes[key];
  }
  store.set(K.graph, graph);
}

/* ================= views ================= */
async function viewHome(alive) {
  document.title = 'Sidetrack';
  view.innerHTML = `
    <section class="intro">
      <h1>Follow the music <em>sideways.</em></h1>
      <p>Start with an artist you already love. Hop to someone similar, then to someone similar to them, and hear a 30-second snippet at every stop.</p>
      <div class="intro__actions">
        <button class="btn btn--primary" type="button" data-action="focus-search">${ic('search')} Search for an artist</button>
        <button class="btn" type="button" data-action="install" id="installBtn" hidden>${ic('install')} Install app</button>
      </div>
    </section>
    ${trail.length ? `<section class="block">
      <div class="block__head"><h2>Pick up your trail</h2><button class="link" type="button" data-action="clear-trail">Start over</button></div>
      ${trailHTML(null)}
    </section>` : ''}
    <section class="block">
      <div class="block__head"><h2>Or start somewhere</h2><span class="hint">Tap ▶ to hear someone first</span></div>
      <div class="chips" id="genres"><button class="chip" type="button" data-action="genre" data-id="0" aria-pressed="true">Popular now</button></div>
      <div class="grid" id="startGrid">${skeletonCards(12)}</div>
    </section>`;
  showInstall();
  scrollTrailToEnd();
  loadGenre(0);
  try {
    const g = await dz('genre');
    if (!alive()) return;
    const chips = (g.data || []).filter(x => x.id !== 0).slice(0, 22)
      .map(x => `<button class="chip" type="button" data-action="genre" data-id="${x.id}" aria-pressed="false">${esc(x.name)}</button>`).join('');
    $('#genres').insertAdjacentHTML('beforeend', chips);
  } catch { /* genre chips are optional */ }
}

let genreSeq = 0;
async function loadGenre(id) {
  const seq = ++genreSeq;
  const grid = $('#startGrid');
  if (!grid) return;
  grid.innerHTML = skeletonCards(12);
  try {
    const res = await dz(id ? `genre/${id}/artists` : 'chart/0/artists', id ? {} : { limit: 24 });
    if (seq !== genreSeq || !grid.isConnected) return;
    const artists = (res.data || []).slice(0, 24).map(slimArtist);
    const list = reg(artists.map(a => ({ artist: a })));
    grid.innerHTML = artists.map((a, i) => artistCard(a, list, i)).join('') || '<p class="hint">Nothing here right now.</p>';
    syncPlaying();
  } catch {
    if (seq !== genreSeq || !grid.isConnected) return;
    grid.innerHTML = '<p class="hint" style="text-align:left;grid-column:1/-1">Couldn’t load artists. Check your connection, then try a search.</p>';
  }
}

async function viewArtist(id, alive, hop) {
  view.innerHTML = `<div class="layout"><div class="side"><section class="artist skel"><div class="artist__pic"></div><div class="artist__body"><div class="skel-line" style="margin:0;width:60%;height:34px"></div></div></section></div>
    <section class="block"><div class="grid">${skeletonCards(12)}</div></section></div>`;
  const [raw, top, rel] = await Promise.all([dz('artist/' + id), dz(`artist/${id}/top`, { limit: 6 }), related(id)]);
  if (!alive()) return;
  const artist = slimArtist(raw);
  knownArtists.set(artist.id, artist);
  const tracks = (top.data || []).map(normTrack);
  relIds.set(id, new Set(rel.map(a => a.id)));
  updateTrail(artist, hop);
  recordGraph(artist, rel);
  const trackList = reg(tracks.map(t => ({ track: t })));
  const relList = reg(rel.map(a => ({ artist: a })));
  current = { artist, relList, count: rel.length };
  document.title = artist.name + ' · Sidetrack';
  const n = trail.length;
  const eyebrow = n > 1 ? `Stop ${n} · via ${esc(trail[n - 2].name)}` : 'Starting point';
  const savedNow = isArtistSaved(artist.id);

  view.innerHTML = `
    ${n > 1 ? trailHTML(artist.id) : ''}
    <div class="layout">
      <div class="side">
        <section class="artist">
          <div class="artist__pic"><img src="${esc(artist.picBig)}" alt="" width="500" height="500"></div>
          <div class="artist__body">
            <p class="eyebrow">${eyebrow}</p>
            <h1>${esc(artist.name)}</h1>
            ${artist.fans ? `<p class="artist__fans">${esc(fans(artist.fans))} on Deezer</p>` : ''}
          </div>
          <div class="artist__actions">
            ${rel.length ? `<button class="btn btn--primary" type="button" data-action="sample-similar">${ic('play')} Sample similar artists</button>` : ''}
            <button class="btn" type="button" data-action="save-artist" data-id="${artist.id}" aria-pressed="${savedNow}">${ic('heart')}<span>${savedNow ? 'Saved' : 'Save artist'}</span></button>
            <button class="btn" type="button" data-action="blend" data-id="${artist.id}">${ic('blend')} Cross with…</button>
          </div>
        </section>
        <section class="block">
          <div class="block__head"><h2>Top songs</h2></div>
          ${tracks.length ? `<ol class="tracks">${tracks.map((t, i) => trackRow(t, trackList, i)).join('')}</ol>` : '<p class="hint" style="text-align:left">No songs listed for this artist.</p>'}
        </section>
      </div>
      <section class="block">
        <div class="block__head"><h2>Similar artists</h2><span class="hint">Tap a face to hop · ▶ to listen first</span></div>
        ${rel.length ? `<div class="grid">${rel.map((a, i) => artistCard(a, relList, i, { hop: true })).join('')}</div>`
          : `<div class="empty"><h2>The trail ends here</h2><p>No similar artists are listed for ${esc(artist.name)}. Step back along your trail or search for someone else.</p></div>`}
      </section>
    </div>`;
  scrollTrailToEnd();
}

async function viewBlend(aId, bId, alive) {
  view.innerHTML = `<section class="blendhead"><p class="eyebrow">Common ground</p><h1>Finding the overlap…</h1></section><div class="grid">${skeletonCards(12)}</div>`;
  const [ra, rb, rawA, rawB] = await Promise.all([related(aId), related(bId), dz('artist/' + aId), dz('artist/' + bId)]);
  if (!alive()) return;
  const A = slimArtist(rawA), B = slimArtist(rawB);
  const pool = new Map();
  const add = (side, artist, weight, direct) => {
    if (artist.id === aId || artist.id === bId) return;
    let e = pool.get(artist.id);
    if (!e) pool.set(artist.id, e = { artist, a: 0, b: 0, da: false, db: false });
    e[side] += weight;
    if (direct) e['d' + side] = true;
  };
  ra.forEach((x, i) => add('a', x, 3 - 2 * i / ra.length, true));
  rb.forEach((x, i) => add('b', x, 3 - 2 * i / rb.length, true));
  const both = () => [...pool.values()].filter(e => e.a > 0 && e.b > 0);

  if (both().length < 10) { // not much direct overlap: look one step further out from each side
    const fanOut = list => Promise.all(list.slice(0, 14).map(x => related(x.id).catch(() => [])));
    const [la, lb] = await Promise.all([fanOut(ra), fanOut(rb)]);
    if (!alive()) return;
    la.forEach(l => l.forEach(x => add('a', x, 0.5, false)));
    lb.forEach(l => l.forEach(x => add('b', x, 0.5, false)));
  }

  const results = both()
    .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || (y.a + y.b) - (x.a + x.b))
    .slice(0, 24);
  const tag = e => e.da && e.db ? 'Close to both' : e.da ? 'Nearer ' + A.name : e.db ? 'Nearer ' + B.name : 'Between the two';
  const list = reg(results.map(e => ({ artist: e.artist })));
  const neighbours = ra.some(x => x.id === bId) || rb.some(x => x.id === aId);
  document.title = `${A.name} × ${B.name} · Sidetrack`;

  view.innerHTML = `
    <section class="blendhead">
      <div class="blendpics"><img src="${esc(A.pic)}" alt=""><img src="${esc(B.pic)}" alt=""></div>
      <p class="eyebrow">Common ground</p>
      <h1><a href="#/artist/${A.id}">${esc(A.name)}</a> <i>×</i> <a href="#/artist/${B.id}">${esc(B.name)}</a></h1>
      <p>${results.length
        ? `${results.length === 1 ? 'One artist sits' : results.length + ' artists sit'} between the two${neighbours ? ', who are already neighbours' : ''}. The closest matches come first.`
        : 'These two are a long way apart, and no one turned up in between. Try a different pairing.'}</p>
    </section>
    ${results.length
      ? `<div class="rowactions"><button class="btn btn--primary" type="button" data-action="play-list" data-list="${list}">${ic('play')} Sample them all</button>
         <button class="btn" type="button" data-action="blend" data-id="${A.id}">${ic('blend')} Try another pairing</button></div>
         <div class="grid">${results.map((e, i) => artistCard(e.artist, list, i, { tag: tag(e) })).join('')}</div>`
      : `<div class="rowactions"><button class="btn" type="button" data-action="blend" data-id="${A.id}">${ic('blend')} Try another pairing</button></div>`}`;
}

function viewSaved(tab) {
  document.title = 'Saved · Sidetrack';
  const showArtists = tab === 'artists';
  const list = showArtists ? reg(saved.artists.map(a => ({ artist: a }))) : reg(saved.tracks.map(t => ({ track: t })));
  const body = showArtists
    ? (saved.artists.length
        ? `<div class="grid">${saved.artists.map((a, i) => artistCard(a, list, i, { removable: true, tag: a.via && a.via.length ? 'via ' + a.via[a.via.length - 1] : '' })).join('')}</div>`
        : `<div class="empty"><h2>No artists saved yet</h2><p>Found someone worth coming back to? Use “Save artist” on their page and they’ll wait for you here.</p><a class="btn btn--primary" href="#/">Start exploring</a></div>`)
    : (saved.tracks.length
        ? `<div class="rowactions">
             <button class="btn btn--primary" type="button" data-action="play-list" data-list="${list}">${ic('play')} Play all snippets</button>
             ${sp ? `<button class="btn" type="button" data-action="sp-like-all">${ic('plus')} Add all to Spotify Liked Songs</button>` : ''}
             <button class="btn" type="button" data-action="copy-saved">${ic('copy')} Copy list</button>
           </div>
           <ol class="tracks">${saved.tracks.map((t, i) => trackRow(t, list, i, { savedView: true })).join('')}</ol>`
        : `<div class="empty"><h2>Nothing saved yet</h2><p>Tap the heart on any song while you explore. It lands here, along with the trail that led you to it.</p><a class="btn btn--primary" href="#/">Start exploring</a></div>`);
  view.innerHTML = `
    <section class="pagehead">
      <div><h1>Saved for later</h1><p>Kept on this device. Tap ⋯ on any song to open it in full on Spotify, Apple Music or Deezer.</p></div>
      <div class="seg">
        <a href="#/saved"${showArtists ? '' : ' aria-current="page"'}>Songs · ${saved.tracks.length}</a>
        <a href="#/saved/artists"${showArtists ? ' aria-current="page"' : ''}>Artists · ${saved.artists.length}</a>
      </div>
    </section>
    ${sp ? body : ''}
    <section class="connect" aria-label="Music services"${sp ? ' style="margin-top:32px"' : ''}>
      <div class="connect__row">
        <h2>Spotify</h2>
        ${sp
          ? `<p><strong>Connected${sp.name ? ' as ' + esc(sp.name) : ''}.</strong></p>
             <label class="check"><input type="checkbox" data-action="toggle-autolike"${prefs.autoLike ? ' checked' : ''}> Hearting a song also adds it to Liked Songs</label>
             <button class="link" type="button" data-action="sp-disconnect">Disconnect</button>`
          : `<p>Connect once, and every song you heart here goes straight into your Liked Songs.</p>
             <button class="btn btn--primary" type="button" data-action="sp-connect">Connect Spotify</button>`}
      </div>
      <div class="connect__row">
        <h2>Apple Music</h2>
        <p>Each song’s ⋯ menu opens the exact track in Apple Music, one tap from adding it there. Apple only lets apps with a paid developer membership add to your library directly.</p>
      </div>
    </section>
    ${sp ? '' : body}`;
}

function viewMap() {
  document.title = 'Map · Sidetrack';
  const nodes = Object.values(graph.nodes);
  if (!nodes.length) {
    view.innerHTML = `<section class="pagehead"><div><h1>Your map</h1></div></section>
      <div class="empty"><h2>Nothing on the map yet</h2><p>Every artist you visit is pinned here, joined to the ones you reached them through.</p><a class="btn btn--primary" href="#/">Start exploring</a></div>`;
    return;
  }
  view.innerHTML = `
    <section class="pagehead">
      <div><h1>Your map</h1><p>Everyone you’ve visited, and the neighbours you haven’t met yet. Tap anyone to go there.</p></div>
      <button class="link" type="button" data-action="clear-map">Clear map</button>
    </section>
    <div class="map" id="map"><div class="map__canvas" id="mapCanvas"></div></div>
    <div class="legend"><span><i></i> A hop you made</span><span><i class="thin"></i> Similar, not visited yet</span></div>`;
  drawMap();
}

function drawMap() {
  const box = $('#map');
  if (!box) return;
  const nodes = Object.values(graph.nodes).map(n => ({ ...n, x: 0, y: 0, dx: 0, dy: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = graph.edges.filter(e => byId.has(e[0]) && byId.has(e[1]));

  nodes.sort((a, b) => (b.v - a.v) || (a.id - b.id));
  nodes.forEach((n, i) => { const ang = i * 2.39996, r = 34 * Math.sqrt(i + 1); n.x = Math.cos(ang) * r; n.y = Math.sin(ang) * r; });
  const STEPS = 320;
  for (let s = 0; s < STEPS; s++) {
    const cool = 1 - s / STEPS;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        const f = 3200 / d2;
        dx = dx / d * f; dy = dy / d * f;
        a.dx += dx; a.dy += dy; b.dx -= dx; b.dy -= dy;
      }
      a.dx -= a.x * 0.012; a.dy -= a.y * 0.012;
    }
    for (const e of edges) {
      const a = byId.get(e[0]), b = byId.get(e[1]);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const want = a.v && b.v ? 170 : 90;
      const f = (d - want) * 0.07;
      a.dx += dx / d * f; a.dy += dy / d * f; b.dx -= dx / d * f; b.dy -= dy / d * f;
    }
    for (const n of nodes) {
      const m = Math.sqrt(n.dx * n.dx + n.dy * n.dy) || 1, cap = Math.min(m, 14) * cool;
      n.x += n.dx / m * cap; n.y += n.dy / m * cap; n.dx = n.dy = 0;
    }
  }

  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const side = Math.sqrt(nodes.length) * 130;
  const W = Math.max(box.clientWidth - 2, side), H = Math.max(box.clientHeight - 2, side * 0.9);
  const padX = 60, padTop = 46, padBottom = 62;
  nodes.forEach(n => {
    n.px = maxX > minX ? padX + (n.x - minX) / (maxX - minX) * (W - 2 * padX) : W / 2;
    n.py = maxY > minY ? padTop + (n.y - minY) / (maxY - minY) * (H - padTop - padBottom) : H / 2;
  });

  const here = trail.length ? trail[trail.length - 1].id : null;
  const canvas = $('#mapCanvas');
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  canvas.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges.map(e => {
    const a = byId.get(e[0]), b = byId.get(e[1]);
    return `<line class="${e[2] ? 'hop' : ''}" x1="${a.px.toFixed(1)}" y1="${a.py.toFixed(1)}" x2="${b.px.toFixed(1)}" y2="${b.py.toFixed(1)}"/>`;
  }).join('')}</svg>${nodes.map(n =>
    `<a class="node${n.v ? ' node--visited' : ''}${n.id === here ? ' node--current' : ''}" href="#/artist/${n.id}" style="left:${n.px.toFixed(1)}px;top:${n.py.toFixed(1)}px" title="${esc(n.name)}"><img src="${esc(n.pic)}" alt="" loading="lazy"><span>${esc(n.name)}</span></a>`
  ).join('')}`;

  const focus = byId.get(here) || nodes[0];
  box.scrollTo(focus.px - box.clientWidth / 2, focus.py - box.clientHeight / 2);
}

function viewError(e) {
  const offline = e && e.network;
  view.innerHTML = `<div class="empty"><h2>${offline ? 'Can’t reach the music' : 'That didn’t load'}</h2>
    <p>${offline ? 'Sidetrack needs a connection to look artists up. Your saved list still works offline.' : 'Something went wrong fetching this page.'}</p>
    <button class="btn btn--primary" type="button" data-action="retry">Try again</button> <a class="btn" href="#/saved">Saved</a></div>`;
}

function scrollTrailToEnd() {
  const t = $('.trail');
  if (t) t.scrollLeft = t.scrollWidth;
}

/* ================= router ================= */
let routeSeq = 0;
function parseRoute() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

async function renderRoute() {
  const seq = ++routeSeq;
  const alive = () => seq === routeSeq;
  const [name, a, b] = parseRoute();
  const hop = Date.now() - hopAt < 1500;
  hopAt = 0;
  routeName = name || 'home';
  lists.clear();
  current = null;
  closeSearch();
  const tab = name === 'saved' ? 'saved' : name === 'map' ? 'map' : 'discover';
  $$('.tabs a').forEach(t => t.dataset.tab === tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
  try {
    if (name === 'artist' && +a) await viewArtist(+a, alive, hop);
    else if (name === 'blend' && +a && +b) await viewBlend(+a, +b, alive);
    else if (name === 'saved') viewSaved(a);
    else if (name === 'map') viewMap();
    else await viewHome(alive);
  } catch (e) {
    if (alive()) viewError(e);
  }
  if (alive()) syncPlaying();
}

window.addEventListener('hashchange', () => { if (sheet.open) sheet.close(); window.scrollTo(0, 0); renderRoute(); });
let resizeTimer;
window.addEventListener('resize', () => { if (routeName !== 'map') return; clearTimeout(resizeTimer); resizeTimer = setTimeout(drawMap, 200); });

/* ================= search ================= */
function makeSearch(input, box, onPick) {
  let seq = 0, timer, items = [];
  const close = () => { seq++; clearTimeout(timer); box.hidden = true; box.innerHTML = ''; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await dz('search/artist', { q, limit: 7 });
        if (mine !== seq) return;
        items = (res.data || []).map(slimArtist);
        box.innerHTML = items.length
          ? items.map(a => `<button type="button" class="result" data-id="${a.id}"><img src="${esc(a.pic)}" alt="" width="44" height="44"><span><strong>${esc(a.name)}</strong><small>${esc(fans(a.fans))}</small></span></button>`).join('')
          : `<p class="results__empty">No artists found for “${esc(q)}”.</p>`;
      } catch {
        if (mine !== seq) return;
        box.innerHTML = '<p class="results__empty">Search isn’t reachable right now. Check your connection.</p>';
      }
      box.hidden = false;
    }, 220);
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.result');
    if (!b) return;
    const a = items.find(x => x.id === +b.dataset.id);
    if (a) onPick(a);
  });
  const move = (from, dir) => {
    const all = $$('.result', box);
    const target = all[all.indexOf(from) + dir];
    if (target) target.focus(); else if (dir < 0) input.focus();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const first = $('.result', box); if (first) first.click(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const first = $('.result', box); if (first) first.focus(); }
    else if (e.key === 'Escape' && !box.hidden) { e.preventDefault(); close(); }
  });
  box.addEventListener('keydown', e => {
    const r = e.target.closest('.result');
    if (!r) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(r, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(r, -1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); input.focus(); }
  });
  return { close };
}

const q = $('#q');
const mainSearch = makeSearch(q, $('#results'), a => {
  knownArtists.set(a.id, a);
  q.value = '';
  mainSearch.close();
  q.blur();
  location.hash = '#/artist/' + a.id;
});
const closeSearch = () => mainSearch.close();
document.addEventListener('click', e => { if (!e.target.closest('.top .search')) mainSearch.close(); });

const picker = $('#picker');
const pq = $('#pq');
const pickSearch = makeSearch(pq, $('#pres'), a => pickBlend(a.id));
function openPicker(baseId) {
  pickerBase = baseId;
  const seen = new Set([baseId]);
  const quick = [...trail].reverse().concat(saved.artists).filter(a => !seen.has(a.id) && seen.add(a.id)).slice(0, 8);
  $('#pickQuick').innerHTML = quick.length
    ? `<p class="eyebrow">From your trail and saves</p><div class="chips chips--wrap">${quick.map(a => `<button type="button" class="chip" data-action="pick" data-id="${a.id}">${esc(a.name)}</button>`).join('')}</div>`
    : '';
  pq.value = '';
  pickSearch.close();
  if (picker.showModal) picker.showModal(); else picker.setAttribute('open', '');
  pq.focus();
}
function pickBlend(id) {
  if (picker.open) picker.close();
  location.hash = `#/blend/${pickerBase}/${id}`;
}
picker.addEventListener('click', e => { if (e.target === picker) picker.close(); });

/* ================= actions ================= */
const actions = {
  'play-artist'(b) {
    const items = lists.get(b.dataset.list), i = +b.dataset.i;
    if (!items || !items[i]) return;
    const a = items[i].artist;
    const curId = P.track ? P.track.artist.id : (P.pending ? P.pending.id : null);
    if (curId === a.id && P.queue === items) { toggle(); return; }
    startQueue(items, i);
  },
  'play-track'(b) {
    const items = lists.get(b.dataset.list), i = +b.dataset.i;
    if (!items || !items[i]) return;
    if (P.track && P.track.id === items[i].track.id) { unlock(); toggle(); return; }
    startQueue(items, i);
  },
  'play-list'(b) {
    const items = lists.get(b.dataset.list);
    if (items && items.length) startQueue(items, 0);
  },
  'sample-similar'() {
    if (current && current.count) startQueue(lists.get(current.relList), 0);
  },
  'save-track'(b) {
    const id = +b.dataset.id;
    const t = knownTracks.get(id) || saved.tracks.find(x => x.id === id);
    if (t) toggleSaveTrack(t);
  },
  'save-artist'(b) {
    const id = +b.dataset.id;
    const a = knownArtists.get(id) || saved.artists.find(x => x.id === id);
    if (a) toggleSaveArtist(a);
  },
  'song-menu'(b) {
    const id = +b.dataset.id;
    const t = knownTracks.get(id) || saved.tracks.find(x => x.id === id);
    if (t) openSheet(t);
  },
  'player-song'() { if (P.track) openSheet(P.track); },
  'close-sheet'() { if (sheet.open) sheet.close(); },
  'sp-connect'() { spConnect(); },
  'sp-disconnect'() { spDisconnect(); toast('Spotify disconnected'); renderRoute(); },
  'toggle-autolike'(b) { prefs.autoLike = b.checked; store.set(K.prefs, prefs); },
  'sp-like-all'() { spLikeAll(); },
  async 'sp-like'(b) {
    const t = sheetTrack;
    if (!t) return;
    b.disabled = true;
    try {
      const res = await spLike(t);
      toast(res === 'ok' ? 'Added to your Spotify Liked Songs' : 'Couldn’t find this song on Spotify.');
    } catch (e) { toast(spError(e)); }
    if (sheetTrack === t && sheet.open) renderSheet();
  },
  'blend'(b) { openPicker(+b.dataset.id); },
  'pick'(b) { pickBlend(+b.dataset.id); },
  'close-picker'() { picker.close(); },
  'genre'(b) {
    $$('#genres .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
    loadGenre(+b.dataset.id);
  },
  'focus-search'() { window.scrollTo({ top: 0 }); q.focus(); },
  'clear-trail'() { trail = []; store.set(K.trail, trail); renderRoute(); },
  'clear-map'() { graph = { nodes: {}, edges: [] }; store.set(K.graph, graph); renderRoute(); },
  'retry'() { renderRoute(); },
  'player-toggle'() { unlock(); toggle(); },
  'player-next'() { unlock(); next(); },
  'player-save'() { if (P.track) toggleSaveTrack(P.track); },
  'player-artist'(b) {
    const id = +b.dataset.id;
    if (!id) return;
    if (routeName === 'artist') hopAt = Date.now();
    location.hash = '#/artist/' + id;
  },
  async 'copy-saved'() {
    const text = saved.tracks.map(t => `${t.artist.name} – ${t.title}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('List copied'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      toast(ok ? 'List copied' : 'Couldn’t copy the list');
    }
  },
  async 'install'() {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* dismissed */ }
    installEvent = null;
    showInstall();
  },
};

document.addEventListener('click', e => {
  if (e.target.closest('a[data-hop]')) hopAt = Date.now();
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const fn = actions[b.dataset.action];
  if (fn) fn(b, e);
});

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, button, a, dialog')) return;
  if (e.code === 'Space' && P.track) { e.preventDefault(); toggle(); }
  else if (e.key === '/') { e.preventDefault(); q.focus(); }
});

/* ================= install as an app ================= */
let installEvent = null;
function showInstall() {
  const b = $('#installBtn');
  if (b) b.hidden = !installEvent;
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; showInstall(); });
window.addEventListener('appinstalled', () => { installEvent = null; showInstall(); toast('Sidetrack is installed'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

/* ================= go ================= */
updateSavedCount();
spFinishSignIn()
  .catch(() => {})
  .then(() => renderRoute())
  .then(() => { if (startupToast) toast(startupToast); });

})();
