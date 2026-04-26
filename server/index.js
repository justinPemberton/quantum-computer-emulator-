import express from "express";
import fs from "fs/promises";
import YAML from "yaml";
import { execFile } from "child_process";

const app = express();
app.use(express.json());

const CONFIG_PATH = "./server/config.yaml";

app.get("/api/config", async (req, res) => {
  const text = await fs.readFile(CONFIG_PATH, "utf8");
  res.json(YAML.parse(text));
});

app.post("/api/config", async (req, res) => {
  const yamlText = YAML.stringify(req.body);
  await fs.writeFile(CONFIG_PATH, yamlText);
  res.json({ ok: true });
});

app.post("/api/run", (req, res) => {
  const seed = req.body?.seed;
  const env = { ...process.env };
  if (seed != null && String(seed).trim() !== "") {
    env.QSIM_SEED = String(seed).trim();
  }

  execFile("bash", ["./server/scripts/run.sh"], { env }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ err: err.message, stderr });
    }
    res.json({ stdout, stderr });
  });
});

app.listen(3001, () => {
  console.log("API on http://localhost:3001");
});
