// Runs in the page's own JS world (every frame). It collects captions and hands
// them to content.js via window.postMessage:
//  - YouTube: fetch the caption track directly, even if captions are switched off.
//  - Everywhere else: watch the subtitle files the player downloads (VTT/SRT/TTML/ASS).
(() => {
  const isYT = /(^|\.)youtube\.com$/.test(location.hostname);
  const send = (cues, videoId) => window.postMessage({ type: 'JT_CUES', videoId, cues }, '*');

  // ---------------- YouTube ----------------
  if (isYT) {
    async function loadCues() {
      const player = document.getElementById('movie_player');
      const resp = player && player.getPlayerResponse && player.getPlayerResponse();
      const videoId = resp && resp.videoDetails && resp.videoDetails.videoId;
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!videoId || !tracks || !tracks.length) return { videoId, cues: [] };
      const track =
        tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr') ||
        tracks.find(t => t.languageCode.startsWith('en')) ||
        tracks[0];
      try {
        const res = await fetch(track.baseUrl + '&fmt=json3');
        const json = await res.json();
        const cues = (json.events || [])
          .filter(e => e.segs)
          .map(e => ({
            start: e.tStartMs / 1000,
            end: (e.tStartMs + (e.dDurationMs || 2000)) / 1000,
            text: e.segs.map(s => s.utf8).join('').replace(/\s*\n\s*/g, ' ').trim()
          }))
          .filter(c => c.text);
        return { videoId, cues };
      } catch (e) {
        return { videoId, cues: [] };
      }
    }
    window.addEventListener('message', async ev => {
      if (ev.source !== window || !ev.data || ev.data.type !== 'JT_REQUEST_CUES') return;
      const r = await loadCues();
      send(r.cues, r.videoId);
    });
    return;
  }

  // ---------------- Other sites: sniff subtitle downloads ----------------
  const clock = s => {              // "01:02:03.456", "02:03,456", "12.5s", "123t"
    s = String(s).trim().replace(',', '.');
    let m;
    if ((m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/))) return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
    if ((m = s.match(/^(\d+(?:\.\d+)?)s$/))) return +m[1];
    if ((m = s.match(/^(\d+(?:\.\d+)?)ms$/))) return +m[1] / 1000;
    if ((m = s.match(/^(\d+)t$/))) return +m[1] / tickRate;
    return NaN;
  };
  let tickRate = 10000000;
  const clean = t => t.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();

  function parseVTT(text) {
    const cues = [];
    for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
      const lines = block.split('\n');
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->').map(x => x.trim().split(/\s+/)[0]);
      const t = clean(lines.slice(i + 1).join(' '));
      if (t) cues.push({ start: clock(a), end: clock(b), text: t });
    }
    return cues;
  }
  function parseTTML(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const tt = doc.documentElement;
    const tr = tt && (tt.getAttribute('ttp:tickRate') || tt.getAttribute('tickRate'));
    if (tr) tickRate = +tr;
    return [...doc.getElementsByTagName('p')].map(p => ({
      start: clock(p.getAttribute('begin')),
      end: clock(p.getAttribute('end')),
      text: clean(p.innerHTML.replace(/<br\s*\/?>/gi, ' '))
    })).filter(c => c.text && !isNaN(c.start) && !isNaN(c.end));
  }
  function parseASS(text) {
    const cues = [];
    let fmt = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (/^Format:/i.test(line) && /Start/.test(line) && /Text/.test(line)) fmt = line.slice(7).split(',').map(s => s.trim());
      if (!/^Dialogue:/i.test(line)) continue;
      const parts = line.slice(9).split(','), n = fmt.length;
      const f = {};
      fmt.forEach((k, idx) => f[k] = idx < n - 1 ? parts[idx] : parts.slice(idx).join(','));
      const t = clean(f.Text || '');
      if (t) cues.push({ start: clock(f.Start), end: clock(f.End), text: t });
    }
    return cues;
  }
  function parse(body) {
    const head = body.slice(0, 600);
    if (/^\s*WEBVTT/.test(head) || /^\s*\d+\s*\n\d+:\d+[:\d.,]*\s*-->/.test(head)) return parseVTT(body);
    if (/\[Script Info\]|\[Events\]/i.test(body.slice(0, 2000))) return parseASS(body);
    if (/<tt[\s>]|<tt:tt|<transcript|<timedtext/i.test(head)) return parseTTML(body);
    return [];
  }
  // Keep only tracks that are mostly Latin letters, so a Japanese/Arabic track isn't shown.
  const mostlyLatin = cues => {
    const s = cues.slice(0, 40).map(c => c.text).join('');
    const letters = s.replace(/[\s\d\W]/g, '');
    return letters.length > 10 && letters.replace(/[^A-Za-z]/g, '').length / letters.length > 0.85;
  };

  let pool = new Map(), href = location.href;
  function ingest(body) {
    try {
      if (location.href !== href) { href = location.href; pool = new Map(); }
      const cues = parse(body).filter(c => !isNaN(c.start) && !isNaN(c.end));
      if (!cues.length || !mostlyLatin(cues)) return;
      for (const c of cues) pool.set(c.start + '|' + c.text, c);
      send([...pool.values()].sort((a, b) => a.start - b.start));
    } catch (e) {}
  }
  const maybeSubtitle = (url, type) =>
    /\.(vtt|srt|ttml2?|dfxp|ass|ssa|xml)(\?|#|$)/i.test(url) ||
    /subtitle|caption|dfxp|ttml|webvtt/i.test(url) ||
    /text\/vtt|ttml|ssa|subrip/i.test(type || '');

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = String(args[0] && args[0].url || args[0]);
      p.then(r => { if (maybeSubtitle(url, r.headers.get('content-type'))) r.clone().text().then(ingest, () => {}); }, () => {});
    } catch (e) {}
    return p;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('load', () => {
      try {
        if ((this.responseType === '' || this.responseType === 'text') &&
            maybeSubtitle(String(url), this.getResponseHeader('content-type'))) ingest(this.responseText);
      } catch (e) {}
    });
    return origOpen.apply(this, arguments);
  };
})();
