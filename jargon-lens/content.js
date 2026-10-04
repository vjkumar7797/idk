(() => {
  if (window.top !== window) { /* still run in iframes with videos */ }
  const state = { video: null, cues: [], cueText: '', settings: { autoHighlight: true, nativeLang: 'te', swapWords: true }, trText: new Map(), trCache: new Map(), known: new Set(), saved: {}, pinned: false };

  // ---------- storage ----------
  const loadStore = () => chrome.storage.local.get(['known', 'words', 'settings']).then(s => {
    state.known = new Set(s.known || []);
    state.saved = s.words || {};
    state.settings = { autoHighlight: true, nativeLang: 'te', swapWords: true, ...(s.settings || {}) };
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

  const ytId = () => /youtube\.com$/.test(location.hostname) ? new URLSearchParams(location.search).get('v') : null;
  const pageKey = () => location.pathname + '|' + (new URLSearchParams(location.search).get('v') || '');

  window.addEventListener('message', ev => {
    if (ev.source === window && ev.data && ev.data.type === 'JT_CUES' && ev.data.cues.length) {
      const cur = ytId();
      if (cur && ev.data.videoId && ev.data.videoId !== cur) return;   // stale data from the previous video
      state.cues = ev.data.cues;
      state.cuesFor = ev.data.videoId || cur;
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
    if (state.pageKey !== pageKey()) { state.pageKey = pageKey(); state.cues = []; state.cuesFor = null; state.ytTries = 0; state.ytLast = 0; }
    const id = ytId();
    if (id) {
      if (state.cuesFor !== id) {
        state.cues = [];
        // Ask the page for the caption track, but gently: every 3s, at most 12 times per video.
        const now = Date.now();
        if ((state.ytTries || 0) < 12 && now - (state.ytLast || 0) > 3000) {
          state.ytLast = now; state.ytTries = (state.ytTries || 0) + 1;
          window.postMessage({ type: 'JT_REQUEST_CUES' }, '*');
        }
      }
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

  // ---------- translation (Chrome's on-device Translator first, local Ollama as fallback) ----------
  const chromeTranslators = {};
  async function chromeTranslate(text, lang) {
    if (!('Translator' in self)) return null;
    if (!chromeTranslators[lang]) {
      chromeTranslators[lang] = (async () => {
        const opts = { sourceLanguage: 'en', targetLanguage: lang };
        // Only use it when the language pack is already installed (the popup's "Prepare" button downloads it).
        if ((await Translator.availability(opts)) !== 'available') return null;
        return Translator.create(opts);
      })().catch(() => null);
    }
    const t = await chromeTranslators[lang];
    if (!t) return null;
    try { return (await t.translate(text)) || null; } catch (e) { return null; }
  }

  function translate(word) {
    const lang = state.settings.nativeLang, key = lang + '|' + word.toLowerCase();
    if (state.trCache.has(key)) return state.trCache.get(key);
    const p = (async () => {
      let text = await chromeTranslate(word, lang);
      if (!text) {
        const r = await chrome.runtime.sendMessage({ type: 'translate', word, context: state.cueText, lang }).catch(() => null);
        text = r && r.text;
      }
      if (text) state.trText.set(key, text); else state.trCache.delete(key);
      return text || null;
    })();
    state.trCache.set(key, p);
    return p;
  }

  // Replace a hard word in the caption with its translation; the original shows on hover and in the card.
  function swapWord(span, part, word) {
    translate(word).then(tr => {
      if (!tr || !span.isConnected) return;
      // Keep the English visible; the native word is shown only while the cursor is on the word (CSS :hover).
      const o = document.createElement('span'), t = document.createElement('span');
      o.className = 'jt-o'; o.textContent = part;
      t.className = 'jt-t'; t.textContent = part.replace(word, tr);
      span.textContent = '';
      span.append(o, t);
      span.classList.add('jt-swapped');
    });
  }

  // Card headword: English by default, the native word while the cursor is on it.
  const trSpan = w => {
    const tr = state.trText.get(state.settings.nativeLang + '|' + w.toLowerCase());
    return tr ? `<span class="jt-t">${esc(tr)}</span>` : '';
  };

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
      if (word && state.settings.swapWords && isHard(word)) swapWord(span, part, word);
    }
    if (state.video.paused) markHard();
    prefetch(text);
  }

  // Look hard words up in the background so the card is already cached when you hover.
  const prefetched = new Set();
  function prefetch(text) {
    for (const w of text.split(/\s+/).map(x => x.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter(isHard).slice(0, 4)) {
      const k = w.toLowerCase();
      if (prefetched.has(k)) continue;
      prefetched.add(k);
      chrome.runtime.sendMessage({ type: 'lookup', word: w, prefetch: true }).catch(() => {});
    }
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
    if (!state.warmed) { state.warmed = true; chrome.runtime.sendMessage({ type: 'warm' }).catch(() => {}); }
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
      <div class="jt-head"><b class="jt-hw${trSpan(w) ? ' has-tr' : ''}"><span class="jt-o">${esc(w)}</span>${trSpan(w)}</b> <span>${esc(res.phonetic || '')}</span><small>${esc(res.source)}</small></div>
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

  function showWords(words, anchor, pin) {
    card.hidden = false;
    state.pinned = !!pin;
    // Show every word's slot immediately, then fill each as soon as its answer is ready.
    card.innerHTML = words.map(w => `<div class="jt-entry" data-word="${esc(w)}"><div class="jt-head"><b>${esc(w)}</b></div><div class="jt-loading">Looking up…</div></div>`).join('');
    const ar = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(ar.left - rr.left, rr.width - 360)) + 'px';
    card.style.bottom = (rr.bottom - ar.top + 8) + 'px';
    const slots = [...card.querySelectorAll('.jt-entry')];
    words.forEach((w, i) => ask(w).then(r => {
      if (!slots[i].isConnected) return;
      const t = document.createElement('template');
      t.innerHTML = entryHTML(r);
      const el = t.content.firstElementChild;
      slots[i].replaceWith(el);
      // add the native-language line as soon as the translation is ready
      translate(w).then(tr => {
        const hw = el.querySelector('.jt-hw');
        if (tr && hw && el.isConnected && !hw.querySelector('.jt-t')) { hw.insertAdjacentHTML('beforeend', trSpan(w)); hw.classList.add('has-tr'); }
      });
    }));
  }

  // ---------- interactions ----------
  let hoverTimer;
  capLine.addEventListener('mouseover', e => {
    const s = e.target.closest('.jt-w[data-word]');
    if (!s || state.pinned) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showWords([s.dataset.word], s, false), 150);
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
