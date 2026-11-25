import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".md": "text/plain; charset=utf-8",
};
/** Start a dependency-free development server; production uses Caddy HTTPS. */
/** Start the dependency-free development server with safe static paths and correct MIME types. */
export function startServer({ host = "127.0.0.1", port = 8080 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, "http://localhost"),
        pathname = decodeURIComponent(url.pathname),
        file = path.resolve(
          root,
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const resolved = await fs.realpath(file);
      if (!resolved.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(resolved).pipe(res);
    } catch (error) {
      res.writeHead(
        ["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)
          ? 404
          : error instanceof URIError
            ? 400
            : 500,
      );
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--host") options.host = args[i + 1];
    else if (args[i] === "--port") options.port = Number(args[i + 1]);
    else throw Error("Use --host ADDRESS --port NUMBER");
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  )
    throw Error("Port must be 1–65535");
  const server = await startServer(options);
  console.log(
    "Leafnote development server: http://" +
      (options.host || "127.0.0.1") +
      ":" +
      server.address().port,
  );
}
