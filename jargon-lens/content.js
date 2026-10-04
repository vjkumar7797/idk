(() => {
  if (window.top !== window) { /* still run in iframes with videos */ }
  const state = { video: null, cues: [], cueText: '', settings: { autoHighlight: true }, known: new Set(), saved: {}, pinned: false };

  // ---------- storage ----------
  const loadStore = () => chrome.storage.local.get(['known', 'words', 'settings']).then(s => {
    state.known = new Set(s.known || []);
    state.saved = s.words || {};
    state.settings = { autoHighlight: true, ...(s.settings || {}) };
  });
  loadStore();
  chrome.storage.onChanged.addListener(loadStore);

  // ---------- overlay ----------
  const root = document.createElement('div');
  root.id = 'jt-root';
  const capLine = document.createElement('div');
  capLine.id = 'jt-caption';
  const card = document.createElement('div');
  card.id = 'jt-card';
  card.hidden = true;
  root.append(capLine, card);

  function mount() {
    const host = document.fullscreenElement || document.body;
    if (root.parentNode !== host) host.appendChild(root);
  }
  document.addEventListener('fullscreenchange', mount);

  function position() {
    const v = state.video;
    if (!v) return;
    const r = v.getBoundingClientRect();
    root.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
  }

  // ---------- video + cue discovery ----------
  function pickVideo() {
    const vids = [...document.querySelectorAll('video')].filter(v => v.offsetWidth > 200);
    vids.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight);
    return vids[0] || null;
  }

  function loadTextTracks(v) {
    // Generic <track> support; "hidden" loads cues without showing the site's own captions.
    const out = [];
    for (const t of v.textTracks) {
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'disabled') t.mode = 'hidden';
      for (const c of t.cues || []) out.push({ start: c.startTime, end: c.endTime, text: c.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
    }
    return out;
  }

  window.addEventListener('message', ev => {
    if (ev.source === window && ev.data && ev.data.type === 'JT_CUES' && ev.data.cues.length) {
      state.cues = ev.data.cues;
      state.cuesFor = ev.data.videoId;
    }
  });

  // Sites like Prime Video draw subtitles as plain page text; read that when no timed cues exist.
  const LIVE_SEL = ['.atvwebplayersdk-captions-text', '.player-timedtext', '.jw-captions', '.vjs-text-track-display', '.plyr__captions'];
  function liveText() {
    for (const sel of LIVE_SEL) {
      const t = [...document.querySelectorAll(sel)].map(e => e.textContent.trim()).filter(Boolean).join(' ');
      if (t) return t.replace(/\s+/g, ' ');
    }
    return '';
  }

  function ensureCues() {
    const v = state.video;
    if (!v) return;
    if (state.href !== location.href) { state.href = location.href; state.cues = []; state.cuesFor = null; }
    if (/youtube\.com$/.test(location.hostname)) {
      const id = new URLSearchParams(location.search).get('v');
      if (id && state.cuesFor !== id) { state.cues = []; window.postMessage({ type: 'JT_REQUEST_CUES' }, '*'); }
    } else if (!state.cues.length) {
      state.cues = loadTextTracks(v);
    }
  }

  // ---------- hard-word detection ----------
  const stems = w => [w, w.replace(/(s|es|ed|d|ing|ly|er)$/, ''), w.replace(/ies$/, 'y'), w.replace(/ing$/, 'e')];
  function isHard(word) {
    const w = word.toLowerCase();
    if (!/^[a-z][a-z'-]*$/.test(w) || state.known.has(w)) return false;
    if (stems(w).some(s => window.JT_COMMON.has(s))) return false;
    return w.length >= 7;
  }

  // ---------- caption rendering ----------
  function renderCue(text) {
    capLine.textContent = '';
    if (!text) return;
    for (const part of text.split(/(\s+)/)) {
      if (!part.trim()) { capLine.append(part); continue; }
      const word = part.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      const span = document.createElement('span');
      span.className = 'jt-w';
      span.textContent = part;
      if (word) span.dataset.word = word;
      capLine.append(span);
    }
    if (state.video.paused) markHard();
  }

  function markHard() {
    if (!state.settings.autoHighlight) return;
    for (const s of capLine.querySelectorAll('.jt-w[data-word]')) {
      if (isHard(s.dataset.word)) s.classList.add('jt-hard');
    }
  }

  function tick() {
    const v = state.video = pickVideo() || state.video;
    if (!v) return;
    mount(); position(); ensureCues();
    const t = v.currentTime;
    const cue = state.cues.find(c => t >= c.start && t < c.end);
    let text = cue ? cue.text : '';
    if (!state.cues.length) text = liveText();
    document.documentElement.classList.toggle('jt-live', !state.cues.length && !!text);
    if (text !== state.cueText) { state.cueText = text; renderCue(text); if (!state.pinned) hideCard(); }
  }
  setInterval(tick, 150);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, { passive: true });

  // ---------- card ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hideCard = () => { card.hidden = true; card.textContent = ''; state.pinned = false; };

  function entryHTML(res, ctx) {
    const w = res.word;
    const body = res.entries.length
      ? res.entries.map(e => `<div class="jt-def"><i>${esc(e.pos)}</i> ${esc(e.def)}${e.example ? `<div class="jt-ex">e.g. “${esc(e.example)}”</div>` : ''}</div>`).join('')
      : `<div class="jt-def">${esc(res.error || 'No meaning found.')}</div>`;
    const saved = !!state.saved[w.toLowerCase()];
    return `<div class="jt-entry" data-word="${esc(w)}">
      <div class="jt-head"><b>${esc(w)}</b> <span>${esc(res.phonetic || '')}</span><small>${esc(res.source)}</small></div>
      ${body}
      <div class="jt-actions">
        <button data-act="explain">Explain simply (AI)</button>
        <button data-act="save">${saved ? '★ Saved' : '☆ Save'}</button>
        <button data-act="know">I know this</button>
        ${res.url ? `<a href="${esc(res.url)}" target="_blank" rel="noopener">More</a>` : ''}
      </div></div>`;
  }

  // Never throws: if the extension was reloaded or its worker died, show that on the card instead.
  const ask = async (word, forceLLM) => {
    const fail = error => ({ word, source: 'none', entries: [], error });
    try {
      const r = await chrome.runtime.sendMessage({ type: 'lookup', word, context: state.cueText, forceLLM });
      return r || fail('No reply from the extension. Reload this tab and try again.');
    } catch (e) {
      return fail('Extension error (' + (e && e.message || e) + '). If you just reloaded the extension, reload this tab.');
    }
  };

  async function showWords(words, anchor, pin) {
    card.hidden = false;
    state.pinned = !!pin;
    card.innerHTML = '<div class="jt-loading">Looking up…</div>';
    const results = await Promise.all(words.map(w => ask(w)));
    card.innerHTML = results.map(r => entryHTML(r)).join('');
    const ar = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(ar.left - rr.left, rr.width - 360)) + 'px';
    card.style.bottom = (rr.bottom - ar.top + 8) + 'px';
  }

  // ---------- interactions ----------
  let hoverTimer;
  capLine.addEventListener('mouseover', e => {
    const s = e.target.closest('.jt-w[data-word]');
    if (!s || state.pinned) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showWords([s.dataset.word], s, false), 350);
  });
  capLine.addEventListener('mouseout', () => { clearTimeout(hoverTimer); if (!state.pinned) hideCard(); });
  capLine.addEventListener('click', e => {
    const s = e.target.closest('.jt-w[data-word]');
    if (s && !String(getSelection())) showWords([s.dataset.word], s, true);
  });
  // select a phrase (e.g. "gradient descent") and release the mouse
  capLine.addEventListener('mouseup', () => {
    const sel = String(getSelection()).trim();
    if (sel.includes(' ') && sel.length < 60) showWords([sel], capLine, true);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });

  card.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const entry = b.closest('.jt-entry'), word = entry.dataset.word, key = word.toLowerCase();
    if (b.dataset.act === 'explain') {
      b.textContent = 'Thinking…';
      entry.outerHTML = entryHTML(await ask(word, true));
    } else if (b.dataset.act === 'save') {
      const res = await ask(word);
      const words = { ...state.saved };
      if (words[key]) delete words[key];
      else words[key] = { word, def: res.entries[0]?.def || '', example: res.entries[0]?.example || '', at: Date.now() };
      state.saved = words;
      await chrome.storage.local.set({ words });
      b.textContent = words[key] ? '★ Saved' : '☆ Save';
    } else if (b.dataset.act === 'know') {
      state.known.add(key);
      await chrome.storage.local.set({ known: [...state.known] });
      capLine.querySelectorAll('.jt-hard').forEach(s => { if (s.dataset.word.toLowerCase() === key) s.classList.remove('jt-hard'); });
      hideCard();
    }
  });

  // ---------- pause = explain ----------
  document.addEventListener('pause', e => {
    if (e.target !== state.video) return;
    markHard();
    const hard = [...new Set([...capLine.querySelectorAll('.jt-hard')].map(s => s.dataset.word.toLowerCase()))].slice(0, 3);
    if (hard.length && state.settings.autoHighlight) {
      showWords(hard, capLine.querySelector('.jt-hard'), true);
    }
  }, true);
  document.addEventListener('play', e => {
    if (e.target !== state.video) return;
    hideCard();
    capLine.querySelectorAll('.jt-hard').forEach(s => s.classList.remove('jt-hard'));
  }, true);
})();
