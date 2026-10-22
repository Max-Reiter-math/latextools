// Connection to the Python backend when running inside the desktop app.
// The desktop app opens index.html?desktop; in a normal browser there is
// no Python and the apps use the JavaScript twins in backend/ instead.

export const isDesktop = new URLSearchParams(location.search).has("desktop");

function pythonReady() {
  if (window.pywebview?.api) return Promise.resolve();
  return new Promise(resolve => window.addEventListener("pywebviewready", resolve, { once: true }));
}

// Call a method of the Api class in latextools/desktop.py.
export async function python(method, ...args) {
  await pythonReady();
  return window.pywebview.api[method](...args);
}
