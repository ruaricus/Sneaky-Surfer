import { toTargetUrl, proxifyUrl } from './rewrite.js';

const SUPABASE_URL = 'https://yfayhuhtfbdhpwsnhrlo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmYXlodWh0ZmJkaHB3c25ocmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjkyMzIsImV4cCI6MjA4OTMwNTIzMn0.WndnkO5sdjhikWdhcMVbIVOLjmDzGKiIQ6D8TPRN90U';

const form = document.getElementById('proxyForm');
const input = document.getElementById('urlInput');
const iframe = document.getElementById('proxyFrame');
const status = document.getElementById('status');

const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function saveHistory(url, query) {
  if (!supabase) return;
  try {
    const title = iframe.contentDocument?.title || null;
    await supabase.from('browsing_history').insert({ url, title, search_query: query || null });
  } catch (error) {
    console.warn('Failed to store browsing history:', error.message);
  }
}

function syncInputWithFrame() {
  try {
    const loc = iframe.contentWindow?.location;
    if (!loc) return;
    const wrapped = new URL(loc.href);
    const target = wrapped.searchParams.get('url');
    if (target) {
      const decoded = decodeURIComponent(target);
      if (decoded && input.value !== decoded) {
        input.value = decoded;
        history.replaceState({ proxied: decoded }, '', `#${encodeURIComponent(decoded)}`);
      }
    }
  } catch {
    // Ignore transient read errors while iframe navigates.
  }
}

async function navigate(raw) {
  if (!raw.trim()) {
    setStatus('Please enter a URL or search query.', true);
    return;
  }

  const target = toTargetUrl(raw);
  const proxied = proxifyUrl(target);
  setStatus(`Loading ${target}...`);
  iframe.src = proxied;
  await saveHistory(target, raw === target ? null : raw);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  navigate(input.value);
});

iframe.addEventListener('load', () => {
  syncInputWithFrame();
  setStatus('Loaded');
});

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'proxy:navigate') return;
  if (event.data.url) {
    input.value = event.data.url;
    history.replaceState({ proxied: event.data.url }, '', `#${encodeURIComponent(event.data.url)}`);
  }
});

setInterval(syncInputWithFrame, 1000);

const initialHash = decodeURIComponent(location.hash.replace(/^#/, ''));
if (initialHash) {
  input.value = initialHash;
  navigate(initialHash);
}
