const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function readConfig(configPath) {
  const defaults = { port: 3000 };

  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return defaults;
  }

  const cfg = { ...defaults };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (key === "port") {
      const port = Number.parseInt(value, 10);
      if (Number.isFinite(port) && port > 0 && port < 65536) cfg.port = port;
    }
  }

  return cfg;
}

const configPath = path.join(__dirname, "config.yaml");
const config = readConfig(configPath);

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad request");
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        name: "quantum-computer-emulator",
        message: "Server scaffold is running",
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(config.port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on http://127.0.0.1:${config.port}`);
});

