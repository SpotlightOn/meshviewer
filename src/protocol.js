import fs from "node:fs";
import path from "node:path";
import { protocol } from "electron";

const PROTOCOL = "app";
const PROJECT_ROOT = path.join(import.meta.dirname, "..");
const RENDERER_ROOT = path.join(import.meta.dirname, "renderer");

// Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/** MIME types for the static assets served by the app:// protocol. */
const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/**
 * Serves the renderer assets and bundled node_modules files through the
 * app:// protocol with MIME types and a CSP header.
 */
function registerAppProtocol() {
  protocol.handle(PROTOCOL, (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");

    if (rel === "") {
      rel = "index.html";
    }

    let root = RENDERER_ROOT;
    if (rel.startsWith("node_modules/")) {
      root = PROJECT_ROOT;
    } else if (rel.startsWith("locales/")) {
      root = import.meta.dirname;
    } else if (rel.startsWith("icons/")) {
      root = PROJECT_ROOT;
    }

    const filePath = path.join(root, rel);
    const relative = path.relative(root, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return new Response("Not found", { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = fs.readFileSync(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": contentType,
        "content-security-policy":
          "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:",
      },
    });
  });
}

export { PROTOCOL, registerAppProtocol };
