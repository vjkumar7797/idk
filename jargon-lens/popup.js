const $ = id => document.getElementById(id);
async function render() {
  const { words = {}, settings = {} } = await chrome.storage.local.get(['words', 'settings']);
  $('auto').checked = settings.autoHighlight !== false;
  $('model').value = settings.ollamaModel || '';
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
  await chrome.storage.local.set({ settings: { ...settings, autoHighlight: $('auto').checked, ollamaModel: $('model').value.trim() || 'llama3.2' } });
}
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
