/**
 * Spotify Cover Grabber
 * Extracts cover art from Spotify URLs using the public oEmbed endpoint.
 * No API key required.
 */

// ============================================
//  REGEX PATTERNS — Extensive URL Validation
// ============================================

/**
 * Master regex that matches ALL supported Spotify URL formats:
 *
 * Supported formats:
 *   https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
 *   https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3
 *   https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk
 *   https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5
 *   With intl prefix:  https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC
 *   With query params: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123
 *   Spotify URI:       spotify:track:4uLU6hMCjMI75M1A2tKUQC
 */

// Individual type-specific patterns (mirroring spotifyHelper.py / refresh.py)
const REGEX_PATTERNS = {
  // Extract artist ID — open.spotify.com(/intl-xx)?/artist/ID
  artist:   /open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/artist\/([a-zA-Z0-9]+)/,

  // Extract track/song ID — open.spotify.com(/intl-xx)?/track/ID  OR  track/ID standalone
  track:    /(?:open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/)?track\/([a-zA-Z0-9]+)/,

  // Extract album ID
  album:    /open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/album\/([a-zA-Z0-9]+)/,

  // Extract playlist ID
  playlist: /open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/playlist\/([a-zA-Z0-9]+)/,

  // Extract podcast/show ID — open.spotify.com(/intl-xx)?/show/ID
  show:     /open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/show\/([a-zA-Z0-9]+)/,

  // Extract episode ID
  episode:  /open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/episode\/([a-zA-Z0-9]+)/,
};

// Unified master regex — catches type + ID in one pass
const SPOTIFY_URL_REGEX =
  /^(?:https?:\/\/)?open\.spotify\.com(?:\/[a-zA-Z0-9-]+)?\/(track|album|artist|playlist|show|episode)\/([a-zA-Z0-9]+)(?:\?[^\s]*)?$/i;

// Spotify URI format (spotify:type:id)
const SPOTIFY_URI_REGEX =
  /^spotify:(track|album|artist|playlist|show|episode):([a-zA-Z0-9]+)$/i;

// URL sanitization — strip dangerous/invalid characters (mirrors command file sanitization)
const INVALID_URL_CHARS = /[^a-zA-Z0-9:/._?=&#-]/g;

// ============================================
//  HELPERS
// ============================================

/**
 * Sanitize user input by removing characters that don't belong in a URL.
 */
function sanitizeUrl(raw) {
  return raw.trim().replace(INVALID_URL_CHARS, '');
}

/**
 * Parse a Spotify URL or URI and return { type, id } or null.
 */
function parseSpotifyInput(raw) {
  const sanitized = sanitizeUrl(raw);

  // Try standard URL format
  let match = sanitized.match(SPOTIFY_URL_REGEX);
  if (match) {
    return { type: match[1].toLowerCase(), id: match[2] };
  }

  // Try Spotify URI format (spotify:track:xxx)
  match = sanitized.match(SPOTIFY_URI_REGEX);
  if (match) {
    return { type: match[1].toLowerCase(), id: match[2] };
  }

  // Fallback: try individual type-specific patterns (more lenient)
  for (const [type, regex] of Object.entries(REGEX_PATTERNS)) {
    match = sanitized.match(regex);
    if (match) {
      return { type, id: match[1] };
    }
  }

  return null;
}

/**
 * Build a canonical Spotify URL from type + ID.
 */
function buildSpotifyUrl(type, id) {
  return `https://open.spotify.com/${type}/${id}`;
}

/**
 * Human-readable label for a Spotify content type.
 */
function typeLabel(type) {
  const labels = {
    track: 'Song',
    album: 'Album',
    artist: 'Artist',
    playlist: 'Playlist',
    show: 'Podcast',
    episode: 'Episode',
  };
  return labels[type] || type;
}

// ============================================
//  UI ELEMENTS
// ============================================

const inputEl      = document.getElementById('spotifyUrl');
const errorEl      = document.getElementById('errorMsg');
const resultEl     = document.getElementById('result');
const coverImg     = document.getElementById('coverImage');
const coverTitle   = document.getElementById('coverTitle');
const coverArtist  = document.getElementById('coverArtist');
const coverType    = document.getElementById('coverType');
const downloadLink = document.getElementById('downloadLink');
const openSpotify  = document.getElementById('openSpotify');
const grabBtn      = document.getElementById('grabBtn');
const btnText      = grabBtn.querySelector('.btn-text');
const btnLoader    = grabBtn.querySelector('.btn-loader');

// Allow pressing Enter to trigger grab
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') grabCover();
});

// ============================================
//  MAIN — GRAB COVER
// ============================================

async function grabCover() {
  // Reset UI
  hideError();
  resultEl.hidden = true;

  const rawUrl = inputEl.value;
  if (!rawUrl.trim()) {
    showError('Please paste a Spotify URL or URI.');
    return;
  }

  // Parse & validate
  const parsed = parseSpotifyInput(rawUrl);
  if (!parsed) {
    showError(
      'Invalid Spotify link. Supported formats:\n' +
      '• https://open.spotify.com/track/...\n' +
      '• spotify:track:...\n' +
      'Types: track, album, artist, playlist, show, episode'
    );
    return;
  }

  const canonicalUrl = buildSpotifyUrl(parsed.type, parsed.id);

  // Show loading state
  setLoading(true);

  try {
    // Use Spotify's public oEmbed endpoint — no API key needed
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      throw new Error(`Spotify returned ${response.status}. The link may be invalid or private.`);
    }

    const data = await response.json();

    // Upscale to largest available cover (640x640)
    const fullResCover = getMaxResCoverUrl(data.thumbnail_url);

    // Populate result card
    coverImg.src = fullResCover;
    coverTitle.textContent = data.title || 'Unknown Title';
    coverArtist.textContent = data.description || '';
    coverType.textContent = typeLabel(parsed.type);
    
    // Store cover data for download
    downloadLink.dataset.imageUrl = fullResCover;
    downloadLink.dataset.filename = `${slugify(data.title || 'cover')}.jpg`;
    downloadLink.href = '#';
    
    openSpotify.href = canonicalUrl;

    // Store for copy
    coverImg.dataset.fullUrl = fullResCover;

    // Show result with animation
    resultEl.hidden = false;
    resultEl.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    resultEl.offsetHeight; // trigger reflow
    resultEl.style.animation = '';
  } catch (err) {
    showError(err.message || 'Failed to fetch cover. Please check the URL and try again.');
  } finally {
    setLoading(false);
  }
}

// ============================================
//  COPY COVER URL
// ============================================

async function downloadCover() {
  const link = downloadLink;
  const imageUrl = link.dataset.imageUrl;
  const filename = link.dataset.filename;
  
  if (!imageUrl) return;

  try {
    // Fetch image as blob to bypass CORS restrictions on download
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    // Create temporary link and trigger download
    const tempLink = document.createElement('a');
    tempLink.href = blobUrl;
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    
    // Clean up blob URL after a short delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
  } catch (err) {
    showError('Failed to download image. Please try again.');
  }
}

async function copyCoverUrl() {
  const url = coverImg.dataset.fullUrl;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copyUrlBtn');
    const original = btn.innerHTML;
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Copied!';
    btn.style.color = 'var(--accent)';
    btn.style.borderColor = 'var(--accent)';
    setTimeout(() => {
      btn.innerHTML = original;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  } catch {
    showError('Failed to copy to clipboard.');
  }
}

// ============================================
//  UI HELPERS
// ============================================

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  errorEl.style.animation = 'none';
  // eslint-disable-next-line no-unused-expressions
  errorEl.offsetHeight;
  errorEl.style.animation = '';
}

function hideError() {
  errorEl.hidden = true;
}

function setLoading(loading) {
  grabBtn.disabled = loading;
  btnText.hidden = loading;
  btnLoader.hidden = !loading;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Upscale Spotify thumbnail URL to the largest available size (640x640).
 * Spotify CDN image hash prefixes:
 *   ab67616d00004851 → 64x64
 *   ab67616d00001e02 → 300x300  (oEmbed default)
 *   ab67616d0000b273 → 640x640  (largest)
 *
 * Also handles artist images and other image prefixes.
 */
function getMaxResCoverUrl(thumbnailUrl) {
  if (!thumbnailUrl) return thumbnailUrl;

  // Known Spotify CDN size prefixes → replace with largest variant
  const sizeMap = [
    // Album / track / playlist covers
    { small: 'ab67616d00004851', large: 'ab67616d0000b273' },
    { small: 'ab67616d00001e02', large: 'ab67616d0000b273' },
    // Artist images
    { small: 'ab6761610000f178', large: 'ab6761610000e5eb' },
    { small: 'ab67616100005174', large: 'ab6761610000e5eb' },
    // Podcast / show images
    { small: 'ab6765630000f68d', large: 'ab6765630000ba8a' },
    { small: 'ab67656300005f1f', large: 'ab6765630000ba8a' },
  ];

  for (const { small, large } of sizeMap) {
    if (thumbnailUrl.includes(small)) {
      return thumbnailUrl.replace(small, large);
    }
  }

  return thumbnailUrl;
}
