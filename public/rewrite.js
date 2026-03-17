const PROXY_ENDPOINT = '/api/proxy?url=';

export function looksLikeUrl(value) {
  if (!value) return false;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(trimmed)) return true;
  return false;
}

export function toTargetUrl(input) {
  const trimmed = input.trim();
  if (looksLikeUrl(trimmed)) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function proxifyUrl(url) {
  return `${PROXY_ENDPOINT}${encodeURIComponent(url)}`;
}
