const CACHE = new Map();
const CACHE_TTL_MS = 60_000;
const RUNTIME_SCRIPT = '/runtime.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'transfer-encoding',
  'x-frame-options',
]);

const ATTRS_TO_REWRITE = [
  ['a', 'href'],
  ['img', 'src'],
  ['script', 'src'],
  ['link', 'href'],
  ['form', 'action'],
  ['iframe', 'src'],
  ['source', 'src'],
];

function getAbsoluteUrl(value, baseUrl) {
  if (!value || /^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(value)) return value;
  try {
    if (value.startsWith('//')) {
      const base = new URL(baseUrl);
      return `${base.protocol}${value}`;
    }
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function proxify(value, baseUrl) {
  const absolute = getAbsoluteUrl(value, baseUrl);
  if (!absolute || /^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(absolute)) return value;
  return `/api/proxy?url=${encodeURIComponent(absolute)}`;
}

function rewriteCss(content, baseUrl) {
  const rewrittenUrls = content.replace(/url\(([^)]+)\)/gi, (match, raw) => {
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, '');
    return `url("${proxify(cleaned, baseUrl)}")`;
  });

  return rewrittenUrls.replace(/@import\s+(url\()?['"]([^'"]+)['"]/gi, (match, _urlPart, importPath) => {
    return match.replace(importPath, proxify(importPath, baseUrl));
  });
}

function rewriteHtml(html, baseUrl) {
  let output = html;

  for (const [tag, attr] of ATTRS_TO_REWRITE) {
    const pattern = new RegExp(`<${tag}([^>]*?)\\s${attr}=(['"])(.*?)\\2`, 'gi');
    output = output.replace(pattern, (match, before, quote, value) => {
      return `<${tag}${before} ${attr}=${quote}${proxify(value, baseUrl)}${quote}`;
    });
  }

  output = output.replace(/<meta[^>]+http-equiv=(['"])refresh\1[^>]+>/gi, (metaTag) => {
    return metaTag.replace(/url=([^;"'>]+)/i, (_match, rawUrl) => `url=${proxify(rawUrl, baseUrl)}`);
  });

  output = output.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, cssText) => {
    return match.replace(cssText, rewriteCss(cssText, baseUrl));
  });

  const injection = `<script src="${RUNTIME_SCRIPT}"></script><script>window.__PROXY_TARGET__=${JSON.stringify(baseUrl)};window.parent?.postMessage({type:'proxy:navigate',url:${JSON.stringify(baseUrl)}},'*');</script>`;

  if (output.includes('</head>')) {
    output = output.replace('</head>', `${injection}</head>`);
  } else {
    output = injection + output;
  }

  return output;
}

function sanitizeHeaders(headersObj) {
  const result = {};
  for (const [key, value] of Object.entries(headersObj)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
}

function getCached(url) {
  const entry = CACHE.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    CACHE.delete(url);
    return null;
  }
  return entry;
}

function setCache(url, payload) {
  CACHE.set(url, { ...payload, expires: Date.now() + CACHE_TTL_MS });
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  const target = event.queryStringParameters?.url;

  if (!target) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Missing url parameter' }),
    };
  }

let targetUrl;
try {
  let decoded = decodeURIComponent(target.trim());

  // ✅ Auto-fix missing protocol
  if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) {
    decoded = 'https://' + decoded;
  }

  targetUrl = new URL(decoded).toString();
} catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid target URL' }),
    };
  }

  if (method === 'GET') {
    const cached = getCached(targetUrl);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: {
        'user-agent': event.headers['user-agent'] || 'SneakySurferProxy/1.0',
        accept: event.headers.accept || '*/*',
      },
      body: ['GET', 'HEAD'].includes(method) ? undefined : event.body,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const rawHeaders = Object.fromEntries(response.headers.entries());
    const headers = sanitizeHeaders({ ...rawHeaders, 'access-control-allow-origin': '*', 'x-proxy-target': targetUrl });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let body;
    let isBase64Encoded = true;

    if (contentType.includes('text/html')) {
      body = rewriteHtml(buffer.toString('utf8'), targetUrl);
      headers['content-type'] = 'text/html; charset=utf-8';
      isBase64Encoded = false;
    } else if (contentType.includes('text/css')) {
      body = rewriteCss(buffer.toString('utf8'), targetUrl);
      headers['content-type'] = 'text/css; charset=utf-8';
      isBase64Encoded = false;
    } else if (contentType.includes('javascript') || contentType.includes('json') || contentType.startsWith('text/')) {
      body = buffer.toString('utf8');
      isBase64Encoded = false;
    } else {
      body = buffer.toString('base64');
      isBase64Encoded = true;
    }

    const result = {
      statusCode: response.status,
      headers,
      body,
      isBase64Encoded,
    };

    if (method === 'GET' && response.ok) {
      setCache(targetUrl, result);
    }

    return result;
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed', details: error.message }),
    };
  }
};
