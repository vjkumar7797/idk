# Jargon Lens – to-do list

Status so far: works on YouTube, Prime Video and Crunchyroll (confirmed by the owner). Captions-based only.

## 1. Quality checks (do first)
- [ ] **Telugu translation quality.** Qwen's Telugu looked wrong for some words ("marriage", "haunting", "lineage"). Check Chrome's on-device Translator for English→Telugu (popup shows status). If weak, try a free online translator for Telugu (note: sends words to a third party).
- [ ] **Definition accuracy.** The local model's card for "haunting" described a curse. Improve the prompt (use the caption sentence as context, ask for the sense used) and prefer the dictionary sense when it matches.
- [ ] **Measure card speed** after prefetch/warm-up changes. Decide on warm-up: currently loads the 2.8 GB model whenever a video opens; maybe only on first "Explain simply".
- [ ] **Browser smoke test** never completed in the cloud sandbox (headless extension hung). Try a local Playwright run, or add a small manual test checklist.
- [ ] **Prime Video selectors** (`.atvwebplayersdk-captions-text`) were written from memory – confirm, or rely on subtitle-file sniffing only.

## 2. Features (highest impact first)
- [ ] **"Explain this line" button**: plain-English paraphrase of the whole caption sentence.
- [ ] **Everyday words used as jargon** ("leverage", "bandwidth", "bug"): the hard-word filter skips common words. Add a bigger frequency list and/or domain terms.
- [ ] **Phrase detection**: auto-detect multi-word terms ("gradient descent", "technical debt") instead of requiring a manual selection.
- [ ] **Review after the video**: summary of looked-up words with simple spaced review (data already saved locally).
- [ ] **Domain mode**: pick a topic ("machine learning", "finance") so the right word sense is chosen.
- [ ] **Subtitle language setting**: English is assumed as the source language for translation; make it configurable.
- [ ] **Optional**: remove or toggle the faint dotted underline on swappable words.

## 3. Platform coverage
- [ ] **Auto-enable subtitles on Prime Video / Crunchyroll** (YouTube is already automatic). Needs the real button/menu selectors from DevTools; fragile when sites redesign. Today the user turns English subtitles on once and the site remembers it.
- [ ] **No-caption fallback**: Whisper (transformers.js) from tab audio, plus Tesseract OCR on pause for slides/on-screen text.
- [ ] Netflix and other DRM players: not supported (captions not exposed). Document clearly.
- [ ] Firefox support (needs manifest and `world: MAIN` changes).

## 4. Offline / speed
- [ ] Bundle an offline dictionary (e.g. a trimmed WordNet) so common lookups are instant and need no network.
- [ ] Cache translations persistently for the Chrome Translator path too (Ollama results are already cached).

## 5. If sharing with others later
- [ ] Settings/options page, first-run guide (Ollama install + `OLLAMA_ORIGINS="chrome-extension://*"`; on macOS app: `launchctl setenv`, then quit/reopen the app).
- [ ] Support other LLM providers (Gemini/Groq free tiers) as alternatives to Ollama.
- [ ] Privacy note (what leaves the machine: dictionary/Wikipedia lookups, optional translator), icons, store listing, publish.

## Known limits / notes
- YouTube's caption endpoint and player API can change; if captions stop loading start with `page-hook.js`.
- Reload the video tab after every extension reload, or lookups fail with a "message channel closed" error.
- Competitors for reference: Language Reactor, Trancy, Migaku (language-learning focused; ours targets same-language jargon, free and local).
