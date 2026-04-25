import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

function normalizeGate(value) {
  if (value == null) return null;
  const gate = String(value).trim();
  if (!gate) return null;
  const up = gate.toUpperCase();
  if (up === "NONE" || up === "NOOP" || up === "I" || up === "ID" || up === "IDENTITY") return null;
  return up;
}

function mustNumber(value, ctx) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid number for ${ctx}: ${String(value)}`);
  }
  return n;
}

function matrixFlow({ x1, x2, x3, x4 }) {
  const a = mustNumber(x1, "matrix.x1");
  const b = mustNumber(x2, "matrix.x2");
  const c = mustNumber(x3, "matrix.x3");
  const d = mustNumber(x4, "matrix.x4");

  return `[[{real:${a}, imag:0}, {real:${b}, imag:0}], [{real:${c}, imag:0}, {real:${d}, imag:0}]]`;
}

function buildCircuitYaml(configObj) {
  const qubits = configObj?.circuit?.qubits;
  if (!Array.isArray(qubits) || qubits.length === 0) {
    throw new Error("config is missing circuit.qubits[]");
  }

  const idToIndex = new Map();
  for (let i = 0; i < qubits.length; i++) {
    const id = qubits[i]?.id;
    if (typeof id === "string" && id) idToIndex.set(id, i);
  }

  let maxSegments = 0;
  for (const q of qubits) {
    const segs = Array.isArray(q?.segments) ? q.segments : [];
    maxSegments = Math.max(maxSegments, segs.length);
  }

  let out = "";
  out += `qubits: ${qubits.length}\n`;
  out += "vectors:\n";

  let vectorIndex = 0;
  const seenSwaps = new Set();
  for (let col = 0; col < maxSegments; col++) {
    const ops = [];

    for (let qi = 0; qi < qubits.length; qi++) {
      const segs = Array.isArray(qubits[qi]?.segments) ? qubits[qi].segments : [];
      const seg = segs[col];
      const gate = normalizeGate(seg?.gate);
      if (!gate) continue;

      if (["H", "X", "Y", "Z", "S", "T"].includes(gate)) {
        ops.push({ gate, target: qi });
        continue;
      }

      if (gate === "MEASURE") {
        ops.push({ gate, target: qi });
        continue;
      }

      if (gate === "UF") {
        const uf = seg?.uf ?? {};
        const funcRaw = uf?.function ?? "parity";
        const func = String(funcRaw).trim().toLowerCase();
        if (!["parity", "const0", "const1"].includes(func)) {
          throw new Error(`UF gate has invalid function '${String(funcRaw)}' at qubit ${qi}, segment ${col}`);
        }

        const xbRaw = Array.isArray(uf?.x_bits) ? uf.x_bits : [];
        const xIndices = [];
        for (const bit of xbRaw) {
          const id = String(bit);
          const idx = idToIndex.get(id);
          if (idx == null) {
            throw new Error(`UF x_bits contains unknown qubit '${id}' at qubit ${qi}, segment ${col}`);
          }
          if (idx === qi) continue;
          xIndices.push(idx);
        }

        ops.push({ gate, function: func, xBits: xIndices, yBit: qi });
        continue;
      }

      if (gate === "SWAP") {
        const withId = seg?.swapWith;
        if (!withId) {
          throw new Error(`SWAP gate missing swapWith at qubit ${qi}, segment ${col}`);
        }
        const other = idToIndex.get(String(withId));
        if (other == null) {
          throw new Error(`SWAP swapWith unknown qubit '${String(withId)}' at qubit ${qi}, segment ${col}`);
        }
        if (other === qi) {
          throw new Error(`SWAP swapWith cannot be itself at qubit ${qi}, segment ${col}`);
        }

        const a = Math.min(qi, other);
        const b = Math.max(qi, other);
        const key = `${col}:${a}-${b}`;
        if (seenSwaps.has(key)) continue;
        seenSwaps.add(key);

        ops.push({ gate, targets: [a, b] });
        continue;
      }

      if (gate === "OTHER") {
        if (!seg?.matrix) {
          throw new Error(`OTHER gate missing matrix at qubit ${qi}, segment ${col}`);
        }
        ops.push({ gate, target: qi, matrix: matrixFlow(seg.matrix) });
        continue;
      }

      throw new Error(`unsupported gate '${gate}' at qubit ${qi}, segment ${col}`);
    }

    if (ops.length === 0) continue;

    out += `  - id: v${vectorIndex++}\n`;
    out += "    operations:\n";

    for (const op of ops) {
      out += `      - gate: ${op.gate}\n`;
      if (op.gate === "UF") {
        out += `        function: ${op.function}\n`;
        if (op.xBits.length > 0) {
          out += `        x_bits: [${op.xBits.map((i) => `q${i}`).join(", ")}]\n`;
        }
        out += `        y_bit: q${op.yBit}\n`;
      } else {
        const targets = op.targets ?? [op.target];
        out += `        targets: [${targets.map((i) => `q${i}`).join(", ")}]\n`;
      }
      if (op.gate === "OTHER") {
        out += "        matrix:\n";
        out += `          values: ${op.matrix}\n`;
      }
    }
  }

  if (vectorIndex === 0) {
    out += "  - id: v0\n";
    out += "    operations:\n";
  }

  return out;
}

async function main() {
  const inputPath = process.argv[2] ?? "./server/config.yaml";
  const outputPath = process.argv[3] ?? path.join(process.env.TMPDIR ?? "/tmp", "qsim-circuit.yaml");

  const text = await fs.readFile(inputPath, "utf8");
  const configObj = YAML.parse(text);

  const circuitYaml = buildCircuitYaml(configObj);
  await fs.writeFile(outputPath, circuitYaml);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message ?? String(err));
  process.exit(1);
});
