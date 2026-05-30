const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5600;

const ROOT = path.resolve(__dirname);

http.createServer((req, res) => {
  // Strip query/hash and percent-decode, then resolve against the static root.
  // Reject anything that escapes ROOT (e.g. "/../../CLAUDE.md") so the server
  // can only serve files inside the mockup directory.
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split(/[?#]/)[0]);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html"
      : ext === ".css" ? "text/css"
      : ext === ".js" ? "application/javascript"
      : "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
// Bind to localhost only — this is a local design mockup, not a public server.
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Mockup running at http://localhost:${PORT}`);
});
