import { useEffect, useState } from 'preact/hooks';

/** Segmenti dell'hash: "#database/record/abc" -> ["database", "record", "abc"]. */
export function parseHash(): string[] {
  return location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(...parts: string[]) {
  location.hash = parts.map(encodeURIComponent).join('/');
}

export function recordHref(id: string) {
  return `#database/record/${encodeURIComponent(id)}`;
}
