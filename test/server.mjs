import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.COFFEEBEAN_PORT || 4173);
const shouldOpen = process.argv.includes("--open");
const workspaceUrl = `http://127.0.0.1:${port}/game/iwpc/index.html`;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".pck": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = normalize(urlPath).replace(/^([/\\])+/, "");
  const file = join(root, relative || "game/iwpc/index.html");
  if (!file.startsWith(root) || !statSafe(file)?.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", types[extname(file).toLowerCase()] || "application/octet-stream");
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
});
function statSafe(path) { try { return statSync(path); } catch (_) { return null; } }

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? (process.env.ComSpec || "cmd.exe") : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/d", "/s", "/c", `start "" "${url}"`] : [url];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`CoffeeBean: port ${port} is already in use; opening the existing address.`);
    if (shouldOpen) openBrowser(workspaceUrl);
    process.exit(0);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CoffeeBean TAS workspace: ${workspaceUrl}`);
  if (shouldOpen) openBrowser(workspaceUrl);
});
