# Jargon Lens

A free, no-build Chrome/Edge extension (Manifest V3). While a video plays it draws its own clickable caption line over the player — **even if you turned the site's captions off**. 

- **Hover** a word (or **click** to pin) → meaning + example card.
- **Select** a phrase like "gradient descent" → card for the phrase.
- **Pause** → hard words in the current line are highlighted and explained automatically.
- **Save** words (popup → export CSV), or **I know this** to stop highlighting a word.

**Native-language swap:** pick your language in the popup (default Telugu). Hard words in the caption are replaced by their translation (dotted underline); hover shows the original word, the definition card also shows the translation. Translation uses Chrome's on-device Translator when its language pack is installed (popup → *Prepare Chrome translator*), otherwise your local Ollama model. Subtitles are assumed to be English.

Lookup order (all free, no API keys): `dictionaryapi.dev` → Wikipedia summary → local **Ollama** (also behind "Explain simply (AI)").

## Install
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.
2. For the AI fallback: use your existing [Ollama](https://ollama.com) models: `ollama list` (any installed model works; set it in the popup), then start it with
   `OLLAMA_ORIGINS="chrome-extension://*" ollama serve` (needed so Ollama accepts requests from the extension).

## Limits (v1)
- Needs the video to have captions (YouTube manual/auto captions, or HTML5 `<track>`). No-caption fallbacks (Whisper / OCR) are not built yet.
- Sites that stream captions inside their own player code (e.g. Netflix, some course sites) may not expose cues.
- YouTube can change its caption endpoint; if cues stop loading, that is the first place to look (`page-hook.js`).
