import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const apiOrigin = new URL(process.env.WESTRON_API_ORIGIN || "https://westronskin.sytes.net");
if (
  (apiOrigin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(apiOrigin.hostname))
  || apiOrigin.username
  || apiOrigin.password
) {
  throw new Error("WESTRON_API_ORIGIN must use HTTPS or a local development address.");
}
const port = Number(process.env.PORT || 4173);
const maxRequestBytes = 2 * 1024 * 1024;
const staticFiles = new Set(["index.html", "styles.css", "app.js", "favicon.svg", "skinview3d.bundle.js", "google8c96bc71e2a9fed1.html"]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const allowedApiRoutes = [
  /^\/api\/health$/,
  /^\/api\/v1\/auth\/(?:register|verify-email|resend-verification|login|refresh|logout|request-password-reset|reset-password)$/,
  /^\/api\/v1\/me(?:\/(?:skin|cape))?$/,
];

function sendText(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(message);
}

function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://westronskin.sytes.net",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

async function readRequestBody(request, response) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > maxRequestBytes) {
    sendText(response, 413, "Request body is too large.");
    return null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      sendText(response, 413, "Request body is too large.");
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyApi(request, response, requestUrl) {
  const apiPath = requestUrl.pathname.replace(/^\/_api/, "/api");
  if (!allowedApiRoutes.some((route) => route.test(apiPath))) {
    sendText(response, 404, "Not found.");
    return;
  }
  if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, POST, PUT, DELETE", ...securityHeaders() });
    response.end();
    return;
  }

  const body = request.method === "GET" || request.method === "DELETE"
    ? undefined
    : await readRequestBody(request, response);
  if (body === null) return;

  const headers = new Headers();
  for (const name of ["authorization", "content-type", "x-skin-model"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }

  try {
    const upstream = await fetch(new URL(`${apiPath}${requestUrl.search}`, apiOrigin), {
      method: request.method,
      headers,
      body: body?.length ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });
    const responseHeaders = { ...securityHeaders(), "Cache-Control": "no-store" };
    for (const name of ["content-type", "etag", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    if (!response.headersSent) sendText(response, 502, "Skin API geçici olarak yanıt vermiyor.");
    else response.end();
  }
}

async function serveStatic(response, pathname, headOnly = false) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendText(response, 400, "Invalid path.");
    return;
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  if (!staticFiles.has(relativePath)) {
    sendText(response, 404, "Not found.");
    return;
  }
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    sendText(response, 403, "Forbidden.");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found.");
      return;
    }
    const content = await readFile(filePath);
    const headers = {
      ...securityHeaders(),
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "no-cache",
    };
    response.writeHead(200, headers);
    response.end(headOnly ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") {
      sendText(response, 404, "Not found.");
      return;
    }
    sendText(response, 500, "Unable to load this page.");
  }
}

const server = createServer(async (request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, "http://localhost");
  } catch {
    sendText(response, 400, "Invalid request URL.");
    return;
  }

  if (requestUrl.pathname.startsWith("/_api/")) {
    await proxyApi(request, response, requestUrl);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", ...securityHeaders() });
    response.end();
    return;
  }
  await serveStatic(response, requestUrl.pathname, request.method === "HEAD");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Westron Launcher website is running at http://localhost:${port}`);
});
