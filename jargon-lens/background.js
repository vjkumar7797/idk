// Looks words up. Order: free dictionary API -> Wikipedia -> local Ollama.
const DEFAULTS = { ollamaModel: 'qwen3.8-4b-distill-tuned:latest', autoHighlight: true };
const memCache = new Map();
let modelCache = { configured: null, name: null };

const fetchT = (url, opts = {}, ms = 4000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

async function fromDictionary(word) {
  const r = await fetchT('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
  if (!r.ok) return null;
  const data = await r.json();
  const entries = [];
  let phonetic = '';
  for (const e of data) {
    phonetic = phonetic || e.phonetic || (e.phonetics || []).map(p => p.text).find(Boolean) || '';
    for (const m of e.meanings || []) {
      for (const d of (m.definitions || []).slice(0, 2)) {
        entries.push({ pos: m.partOfSpeech, def: d.definition, example: d.example || '' });
      }
    }
  }
  if (!entries.length) return null;
  return { source: 'Dictionary', phonetic, entries: entries.slice(0, 3) };
}

async function fromWikipedia(word) {
  const r = await fetchT('https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(word.replace(/ /g, '_')) + '?redirect=true');
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.extract || d.type === 'disambiguation') return null;
  return {
    source: 'Wikipedia',
    entries: [{ pos: 'topic', def: d.extract.split('. ').slice(0, 2).join('. '), example: '' }],
    url: d.content_urls?.desktop?.page
  };
}

async function pickModel() {
  const { ollamaModel } = await getSettings();
  if (modelCache.configured === ollamaModel && modelCache.name) return modelCache.name;
  let name = ollamaModel;
  try {
    const tags = await (await fetchT('http://localhost:11434/api/tags', {}, 1500)).json();
    const names = (tags.models || []).map(m => m.name);
    if (names.length && !names.includes(name)) name = names[0];
    modelCache = { configured: ollamaModel, name };   // only cache after a successful check
  } catch (e) {}
  return name;
}

// Loads the model into memory and keeps it there so the first real lookup isn't a cold start.
async function warmOllama() {
  try {
    await fetchT('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: await pickModel(), keep_alive: '30m' })
    }, 60000);
  } catch (e) {}
}

async function fromOllama(word, context) {
  const ollamaModel = await pickModel();
  const prompt =
    `Explain the term "${word}" to someone who finds jargon confusing.\n` +
    (context ? `It was said in this sentence: "${context}"\n` : '') +
    `Reply in exactly this format, nothing else:\n` +
    `MEANING: <one plain-English sentence, no jargon>\n` +
    `EXAMPLE: <one short everyday example sentence using the term>`;
  const r = await fetchT('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false, think: false, keep_alive: '30m',
      options: { temperature: 0.3, num_predict: 120 } })
  }, 60000);
  if (!r.ok) throw new Error('Ollama returned ' + r.status);
  const text = ((await r.json()).response || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const meaning = (text.match(/MEANING:\s*(.+)/i) || [])[1];
  const example = (text.match(/EXAMPLE:\s*(.+)/i) || [])[1];
  if (!meaning) return null;
  return { source: 'Ollama (' + ollamaModel + ')', entries: [{ pos: 'in context', def: meaning.trim(), example: (example || '').trim() }] };
}

async function lookup(word, context, forceLLM, prefetch) {
  const key = word.toLowerCase();
  if (!forceLLM && memCache.has(key)) return memCache.get(key);
  if (!forceLLM) {
    const { cache = {} } = await chrome.storage.local.get('cache');
    if (cache[key]) { memCache.set(key, cache[key]); return cache[key]; }
  }
  let result = null;
  if (!forceLLM) {
    // Ask both free sources at once; prefer the dictionary when both answer.
    const [d, w] = await Promise.all([fromDictionary(key).catch(() => null), fromWikipedia(word).catch(() => null)]);
    result = d || w;
  }
  if (!result && prefetch) return null;   // background prefetch never wakes the LLM
  if (!result) {
    try { result = await fromOllama(word, context); }
    catch (e) {
      result = { source: 'none', entries: [], error:
        'No free definition found, and Ollama is not reachable. Start it with ' +
        'OLLAMA_ORIGINS="chrome-extension://*" ollama serve' };
    }
  }
  result = result || { source: 'none', entries: [], error: 'No meaning found.' };
  result.word = word;
  if (result.entries.length && !forceLLM) {
    memCache.set(key, result);
    const { cache = {} } = await chrome.storage.local.get('cache');
    cache[key] = result;
    const keys = Object.keys(cache);
    if (keys.length > 500) delete cache[keys[0]];
    await chrome.storage.local.set({ cache });
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type === 'lookup') {
    lookup(msg.word, msg.context, msg.forceLLM, msg.prefetch).then(send).catch(e =>
      send({ word: msg.word, source: 'none', entries: [], error: 'Lookup failed: ' + (e && e.message || e) }));
    return true;
  }
  if (msg.type === 'warm') { warmOllama(); return false; }
  if (msg.type === 'getSettings') { getSettings().then(send); return true; }
});
