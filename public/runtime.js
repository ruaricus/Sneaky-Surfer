(() => {
  const PROXY_ENDPOINT = '/api/proxy?url=';
  const ABSOLUTE_PATTERN = /^(https?:)?\/\//i;

  function absolutize(input) {
    try {
      return new URL(input, window.location.href).toString();
    } catch {
      return input;
    }
  }

  function proxify(input) {
    if (!input) return input;
    if (String(input).startsWith(PROXY_ENDPOINT)) return input;
    const absolute = absolutize(input);
    if (!ABSOLUTE_PATTERN.test(absolute) && !absolute.startsWith('data:')) return input;
    if (/^(javascript:|mailto:|tel:|blob:|data:)/i.test(absolute)) return input;
    return `${PROXY_ENDPOINT}${encodeURIComponent(absolute)}`;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (resource, init) => {
    if (typeof resource === 'string') return nativeFetch(proxify(resource), init);
    if (resource instanceof URL) return nativeFetch(proxify(resource.toString()), init);
    if (resource instanceof Request) {
      return nativeFetch(new Request(proxify(resource.url), resource), init);
    }
    return nativeFetch(resource, init);
  };

  const NativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    return NativeOpen.call(this, method, proxify(String(url)), ...rest);
  };
})();
