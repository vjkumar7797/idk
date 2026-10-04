const $ = id => document.getElementById(id);
async function render() {
  const { words = {}, settings = {} } = await chrome.storage.local.get(['words', 'settings']);
  $('auto').checked = settings.autoHighlight !== false;
  $('model').value = settings.ollamaModel || '';
  $('swap').checked = settings.swapWords !== false;
  $('lang').value = settings.nativeLang || 'te';
  trStatus();
  const items = Object.values(words).sort((a, b) => b.at - a.at);
  $('n').textContent = items.length;
  $('list').textContent = '';
  for (const w of items) {
    const d = document.createElement('div');
    d.className = 'w';
    const b = document.createElement('b'); b.textContent = w.word;
    const s = document.createElement('small'); s.textContent = w.def + (w.example ? ` — e.g. "${w.example}"` : '');
    const x = document.createElement('button'); x.textContent = 'remove';
    x.onclick = async () => { delete words[w.word.toLowerCase()]; await chrome.storage.local.set({ words }); render(); };
    d.append(b, s, x); $('list').append(d);
  }
}
async function saveSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, autoHighlight: $('auto').checked, swapWords: $('swap').checked, nativeLang: $('lang').value, ollamaModel: $('model').value.trim() || 'qwen3.8-4b-distill-tuned:latest' } });
}
for (const [code, name] of Object.entries(JT_LANGS)) $('lang').add(new Option(name, code));
async function trStatus() {
  const el = $('trstat'), lang = $('lang').value;
  if (!('Translator' in self)) { el.textContent = 'Chrome translator not available (needs Chrome 138+). Ollama will be used.'; return; }
  try {
    const a = await Translator.availability({ sourceLanguage: 'en', targetLanguage: lang });
    el.textContent = a === 'available' ? 'Chrome translator ready.'
      : a === 'unavailable' ? 'Chrome has no English→' + JT_LANGS[lang] + ' pack. Ollama will be used.'
      : 'Language pack not downloaded yet. Click Prepare.';
  } catch (e) { el.textContent = 'Chrome translator unavailable. Ollama will be used.'; }
}
$('prep').onclick = async () => {
  const el = $('trstat');
  try {
    await Translator.create({ sourceLanguage: 'en', targetLanguage: $('lang').value,
      monitor(m) { m.addEventListener('downloadprogress', e => { el.textContent = 'Downloading ' + Math.round(e.loaded * 100) + '%'; }); } });
    el.textContent = 'Chrome translator ready.';
  } catch (e) { el.textContent = 'Could not prepare: ' + e.message + ' (Ollama will be used).'; }
};
$('lang').onchange = async () => { await saveSettings(); trStatus(); };
$('swap').onchange = saveSettings;
$('auto').onchange = saveSettings; $('model').onchange = saveSettings;
$('clearKnown').onclick = () => chrome.storage.local.set({ known: [] });
$('csv').onclick = async () => {
  const { words = {} } = await chrome.storage.local.get('words');
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const csv = 'word,meaning,example\n' + Object.values(words).map(w => [w.word, w.def, w.example].map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'jargon-words.csv'; a.click();
};
render();
