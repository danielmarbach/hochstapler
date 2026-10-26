// Dev server proxy (used by vite.config.ts). It must keep the browser's Host header: the server's same-origin check
// compares Origin with Host (packages/server/src/security.ts, docs/DESIGN.md #46), and Vite's string shorthand
// `"/api": url` silently sets changeOrigin: true, which rewrites Host to the server port and gets every POST refused.
export interface DevProxyEntry {
  target: string;
  changeOrigin: false;
  ws?: true;
}

export function devProxy(serverUrl: string): Record<"/api" | "/ws", DevProxyEntry> {
  return {
    "/api": { target: serverUrl, changeOrigin: false },
    "/ws": { target: serverUrl, ws: true, changeOrigin: false },
  };
}
