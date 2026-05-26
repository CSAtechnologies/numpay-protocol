const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5600;

http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, file);
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
}).listen(PORT, () => {
  console.log(`Mockup running at http://localhost:${PORT}`);
});
