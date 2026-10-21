// hash router: #/leave/12/form → pattern '/leave/:id/form' → params { id: '12' }
const routes = [];

export function route(pattern, view, options = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '\\/?$');
  routes.push({ re, keys, view, options });
}

export function currentPath() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) {
    location.hash = hash;
    return; // hashchange จะเรียก onChange เอง
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function matchRoute(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      return { ...r, params };
    }
  }
  return null;
}

export function startRouter(onChange) {
  window.addEventListener('hashchange', () => onChange(currentPath()));
  onChange(currentPath());
}
