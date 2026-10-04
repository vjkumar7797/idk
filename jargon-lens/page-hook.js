// Runs in the page's own JS world so it can read YouTube's player data.
// It fetches the caption track even if the viewer has captions turned off,
// then hands the cues to content.js via window.postMessage.
(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

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
    window.postMessage({ type: 'JT_CUES', ...(await loadCues()) }, '*');
  });
})();
