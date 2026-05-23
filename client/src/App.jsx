import React, { useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import infoPageHtml from "./InfoPage/InfoPage.html?raw";

const BOX_SIZE = 50;
const LINE_STEP = 140;
const ROW_GAP = 90;
const START_X = 80;

const GATE_OPTIONS = ["none", "H", "X", "Y", "Z", "S", "T", "MEASURE", "FX", "UF", "SWAP", "OTHER"];

const defaultConfig = {
  circuit: {
    description:
      "A quantum circuit made of qubit rows. Each row contains ordered line segments. A segment may contain no gate, a standard gate, or a custom 2x2 matrix gate.",
    qubits: [
      {
        id: "q0",
        label: "|0>",
        y: 160,
        segments: [
          {
            id: "s0",
            gate: "none"
          }
        ]
      }
    ]
  }
};

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

function complexFrom(value, ctx) {
  if (value != null && typeof value === "object") {
    const re = mustNumber(value.real ?? value.re ?? 0, `${ctx}.real`);
    const im = mustNumber(value.imag ?? value.im ?? 0, `${ctx}.imag`);
    return { real: Math.abs(re) < 1e-15 ? 0 : re, imag: Math.abs(im) < 1e-15 ? 0 : im };
  }

  const re = mustNumber(value ?? 0, ctx);
  return { real: Math.abs(re) < 1e-15 ? 0 : re, imag: 0 };
}

function matrixFlow({ x1, x2, x3, x4 }) {
  const a = complexFrom(x1, "matrix.x1");
  const b = complexFrom(x2, "matrix.x2");
  const c = complexFrom(x3, "matrix.x3");
  const d = complexFrom(x4, "matrix.x4");
  return `[[{real:${a.real}, imag:${a.imag}}, {real:${b.real}, imag:${b.imag}}], [{real:${c.real}, imag:${c.imag}}, {real:${d.real}, imag:${d.imag}}]]`;
}

function parseQubitIndex(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const s = String(value ?? "").trim();
  const m = /^q?(\d+)$/i.exec(s);
  if (!m) throw new Error(`invalid qubit token '${String(value)}'`);
  return Number(m[1]);
}

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return String(Math.random()).slice(2);
}

function uniqIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function tokenizeBoolExpr(expr) {
  const s = String(expr ?? "");
  const tokens = [];

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if (ch === "!" || ch === "~") {
      tokens.push({ type: "op", op: "!" });
      i++;
      continue;
    }

    if (ch === "&") {
      if (s[i + 1] === "&") i++;
      tokens.push({ type: "op", op: "&" });
      i++;
      continue;
    }

    if (ch === "|") {
      if (s[i + 1] === "|") i++;
      tokens.push({ type: "op", op: "|" });
      i++;
      continue;
    }

    if (ch === "^") {
      tokens.push({ type: "op", op: "^" });
      i++;
      continue;
    }

    if (ch === "0" || ch === "1") {
      tokens.push({ type: "num", value: Number(ch) });
      i++;
      continue;
    }

    if (ch === "x" || ch === "X") {
      let j = i + 1;
      while (j < s.length && /\d/.test(s[j])) j++;
      if (j === i + 1) throw new Error(`expected digits after '${ch}' at position ${i + 1}`);
      const idx = Number(s.slice(i + 1, j));
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`invalid variable x${String(s.slice(i + 1, j))}`);
      tokens.push({ type: "var", index: idx });
      i = j;
      continue;
    }

    throw new Error(`invalid character '${ch}' at position ${i + 1}`);
  }

  return tokens;
}

function boolExprToRpn(tokens) {
  const prec = { "!": 3, "&": 2, "^": 1, "|": 0 };
  const rightAssoc = new Set(["!"]);

  const out = [];
  const stack = [];

  for (const tok of tokens) {
    if (tok.type === "num" || tok.type === "var") {
      out.push(tok);
      continue;
    }

    if (tok.type === "op") {
      const p = prec[tok.op];
      if (p == null) throw new Error(`unknown operator '${tok.op}'`);

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type !== "op") break;
        const tp = prec[top.op];
        if (tp == null) break;

        const shouldPop = rightAssoc.has(tok.op) ? p < tp : p <= tp;
        if (!shouldPop) break;
        out.push(stack.pop());
      }

      stack.push(tok);
      continue;
    }

    if (tok.type === "lparen") {
      stack.push(tok);
      continue;
    }

    if (tok.type === "rparen") {
      let found = false;
      while (stack.length > 0) {
        const top = stack.pop();
        if (top.type === "lparen") {
          found = true;
          break;
        }
        out.push(top);
      }
      if (!found) throw new Error("mismatched ')'");
      continue;
    }

    throw new Error(`unknown token type '${tok.type}'`);
  }

  while (stack.length > 0) {
    const top = stack.pop();
    if (top.type === "lparen" || top.type === "rparen") throw new Error("mismatched '('");
    out.push(top);
  }

  return out;
}

function evalBoolExprRpn(rpn, vars) {
  const stack = [];

  for (const tok of rpn) {
    if (tok.type === "num") {
      stack.push(tok.value & 1);
      continue;
    }
    if (tok.type === "var") {
      const v = vars?.[tok.index];
      if (v !== 0 && v !== 1) throw new Error(`x${tok.index} is not set`);
      stack.push(v);
      continue;
    }
    if (tok.type === "op") {
      if (tok.op === "!") {
        if (stack.length < 1) throw new Error("missing operand for '!'");
        const a = stack.pop();
        stack.push(a ? 0 : 1);
        continue;
      }

      if (stack.length < 2) throw new Error(`missing operand for '${tok.op}'`);
      const b = stack.pop();
      const a = stack.pop();
      if (tok.op === "&") stack.push(a & b);
      else if (tok.op === "|") stack.push(a | b);
      else if (tok.op === "^") stack.push(a ^ b);
      else throw new Error(`unknown operator '${tok.op}'`);
      continue;
    }

    throw new Error(`unexpected token '${tok.type}' in RPN`);
  }

  if (stack.length !== 1) throw new Error("invalid expression");
  return stack[0] & 1;
}

function validateUfExpression(expr, varCount) {
  const n = typeof varCount === "number" ? varCount : Number(varCount);
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new Error("x bit count must be an integer from 1 to 8");

  const tokens = tokenizeBoolExpr(expr);
  const rpn = boolExprToRpn(tokens);

  let maxVar = -1;
  for (const t of tokens) {
    if (t.type === "var") maxVar = Math.max(maxVar, t.index);
  }
  if (maxVar >= n) throw new Error(`expression references x${maxVar} but x bit count is ${n}`);

  const table = [];
  for (let x = 0; x < 1 << n; x++) {
    const vars = new Array(n);
    for (let i = 0; i < n; i++) vars[i] = (x >> i) & 1;
    table.push(String(evalBoolExprRpn(rpn, vars)));
  }

  return table.join("");
}

function qubitsList(indices) {
  return `[${indices.map((i) => `q${i}`).join(", ")}]`;
}

function phaseComplex(angle) {
  const re = Math.cos(angle);
  const im = Math.sin(angle);
  return {
    re: Math.abs(re) < 1e-15 ? 0 : re,
    im: Math.abs(im) < 1e-15 ? 0 : im
  };
}

function phaseMatrixValues(angle) {
  const { re, im } = phaseComplex(angle);
  return `[[{real:1, imag:0}, {real:0, imag:0}], [{real:0, imag:0}, {real:${re}, imag:${im}}]]`;
}

function controlledSwapOp(control, a, b) {
  return { gate: "SWAP", controls: [control], targets: [a, b] };
}

function rotateRight4Ops(shift, control, y0 = 4) {
  const q4 = y0;
  const q5 = y0 + 1;
  const q6 = y0 + 2;
  const q7 = y0 + 3;

  if (shift === 0) return [];
  if (shift === 1) {
    return [
      controlledSwapOp(control, q6, q7),
      controlledSwapOp(control, q5, q6),
      controlledSwapOp(control, q4, q5)
    ];
  }
  if (shift === 2) {
    return [controlledSwapOp(control, q4, q6), controlledSwapOp(control, q5, q7)];
  }
  if (shift === 3) {
    // left-rotate by 1
    return [
      controlledSwapOp(control, q4, q5),
      controlledSwapOp(control, q5, q6),
      controlledSwapOp(control, q6, q7)
    ];
  }
  throw new Error(`unsupported rotateRight4 shift: ${shift}`);
}

function shor15CircuitYamlVectors({ N, a }) {
  const n = Number(N);
  const base = Number(a);
  if (!Number.isInteger(n) || n <= 1) throw new Error("N must be an integer > 1");
  if (n !== 15) throw new Error("only N=15 is supported for the 8-qubit compiled Shor circuit right now");
  if (!Number.isInteger(base) || base <= 1 || base >= n) throw new Error("a must be an integer with 1 < a < N");
  if (base !== 2 && base !== 8) throw new Error("supported a values for Shor(8q, N=15) are 2 or 8");

  const ops = [];

  // 8 qubits: x register q0..q3, y register q4..q7.

  // |y> = |1>
  ops.push({ gate: "X", targets: [4] });

  // Uniform superposition over x
  ops.push({ gate: "H", targets: [0] });
  ops.push({ gate: "H", targets: [1] });
  ops.push({ gate: "H", targets: [2] });
  ops.push({ gate: "H", targets: [3] });

  // Modular exponentiation: y <- y * a^x mod 15, compiled for a=2 or a=8.
  const p = base === 2 ? 1 : 3; // base == 2^p mod 15
  for (let bit = 0; bit < 4; bit++) {
    const shift = (p * (1 << bit)) % 4;
    ops.push(...rotateRight4Ops(shift, bit));
  }

  // Inverse QFT on x register (q0..q3), with q0 as the least-significant bit.
  ops.push({ gate: "SWAP", targets: [0, 3] });
  ops.push({ gate: "SWAP", targets: [1, 2] });

  // j=0
  ops.push({ gate: "H", targets: [0] });

  // j=1
  ops.push({ gate: "OTHER", controls: [0], targets: [1], matrix: phaseMatrixValues(-Math.PI / 2) });
  ops.push({ gate: "H", targets: [1] });

  // j=2
  ops.push({ gate: "OTHER", controls: [0], targets: [2], matrix: phaseMatrixValues(-Math.PI / 4) });
  ops.push({ gate: "OTHER", controls: [1], targets: [2], matrix: phaseMatrixValues(-Math.PI / 2) });
  ops.push({ gate: "H", targets: [2] });

  // j=3
  ops.push({ gate: "OTHER", controls: [0], targets: [3], matrix: phaseMatrixValues(-Math.PI / 8) });
  ops.push({ gate: "OTHER", controls: [1], targets: [3], matrix: phaseMatrixValues(-Math.PI / 4) });
  ops.push({ gate: "OTHER", controls: [2], targets: [3], matrix: phaseMatrixValues(-Math.PI / 2) });
  ops.push({ gate: "H", targets: [3] });

  // Measure x register
  ops.push({ gate: "MEASURE", targets: [0, 1, 2, 3] });

  let out = "";
  out += "qubits: 8\n";
  out += "vectors:\n";

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    out += `  - id: v${i}\n`;
    out += "    operations:\n";
    out += `      - gate: ${op.gate}\n`;

    if (Array.isArray(op.controls) && op.controls.length > 0) {
      out += `        controls: ${qubitsList(op.controls)}\n`;
    }

    if (Array.isArray(op.targets) && op.targets.length > 0) {
      out += `        targets: ${qubitsList(op.targets)}\n`;
    }

    if (op.gate === "OTHER") {
      out += "        matrix:\n";
      out += `          values: ${op.matrix}\n`;
    }
  }

  return out;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function gcdBigInt(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function modPow(base, exp, mod) {
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  let acc = 1n;
  while (e > 0n) {
    if (e & 1n) acc = (acc * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return acc;
}

function measurementsToInt(measurements, qubits) {
  let out = 0;
  const needed = new Set(qubits);
  for (const m of measurements) {
    if (!needed.has(m.qubit)) continue;
    if (m.value) out |= 1 << m.qubit;
    needed.delete(m.qubit);
  }
  if (needed.size > 0) {
    throw new Error(`missing measurement(s) for: ${Array.from(needed).map((q) => `q${q}`).join(", ")}`);
  }
  return out;
}

function tryFactor({ N, a, Q, c }) {
  if (!Number.isInteger(c) || c <= 0) return null;
  const g = gcd(c, Q);
  if (!Number.isInteger(g) || g <= 0) return null;

  const r = Q / g;
  if (r <= 1 || r % 2 !== 0) return null;

  const bigN = BigInt(N);
  const bigA = BigInt(a);
  const x = modPow(bigA, BigInt(r / 2), bigN);

  const f1 = gcdBigInt(x - 1n, bigN);
  const f2 = gcdBigInt(x + 1n, bigN);
  if (f1 === 1n || f1 === bigN) return null;
  if (f2 === 1n || f2 === bigN) return null;

  const n1 = Number(f1);
  const n2 = Number(f2);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;
  if (n1 * n2 !== N) return null;

  return { r, factors: [Math.min(n1, n2), Math.max(n1, n2)] };
}

function buildQsimYaml(configObj) {
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
  let fxStarted = false;
  const measured = new Array(qubits.length).fill(false);

  for (let col = 0; col < maxSegments; col++) {
    const ops = [];

    for (let qi = 0; qi < qubits.length; qi++) {
      const segs = Array.isArray(qubits[qi]?.segments) ? qubits[qi].segments : [];
      const seg = segs[col];
      const gate = normalizeGate(seg?.gate);
      if (!gate) continue;

      const controlsRaw = uniqIds(seg?.controls);
      const controlIndices = [];
      for (const ctrlId of controlsRaw) {
        const idx = idToIndex.get(ctrlId);
        if (idx == null) {
          throw new Error(`controls contains unknown qubit '${ctrlId}' at qubit ${qi}, segment ${col}`);
        }
        if (idx === qi) {
          throw new Error(`controls cannot include target qubit '${ctrlId}' at qubit ${qi}, segment ${col}`);
        }
        controlIndices.push(idx);
      }

      if (["H", "X", "Y", "Z", "S", "T"].includes(gate)) {
        ops.push({ gate, target: qi, controls: controlIndices });
        continue;
      }

      if (gate === "MEASURE") {
        if (controlIndices.length > 0) {
          throw new Error(`MEASURE does not support controls at qubit ${qi}, segment ${col}`);
        }
        ops.push({ gate, target: qi, controls: [] });
        continue;
      }

      if (gate === "FX") {
        if (controlIndices.length > 0) {
          throw new Error(`FX does not support controls at qubit ${qi}, segment ${col}`);
        }

        const fx = seg?.fx ?? {};
        const funcRaw = fx?.function ?? "parity";
        const func = String(funcRaw).trim().toLowerCase();
        if (!["parity", "const0", "const1"].includes(func)) {
          throw new Error(`FX gate has invalid function '${String(funcRaw)}' at qubit ${qi}, segment ${col}`);
        }

        const xbRaw = Array.isArray(fx?.x_bits) ? fx.x_bits : [];
        const xIndices = [];
        for (const bit of xbRaw) {
          const id = String(bit);
          const idx = idToIndex.get(id);
          if (idx == null) {
            throw new Error(`FX x_bits contains unknown qubit '${id}' at qubit ${qi}, segment ${col}`);
          }
          xIndices.push(idx);
        }

        ops.push({ gate, function: func, xBits: xIndices, controls: [] });
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

        ops.push({ gate, function: func, xBits: xIndices, yBit: qi, controls: controlIndices });
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

        if (controlIndices.includes(a) || controlIndices.includes(b)) {
          throw new Error(`SWAP controls cannot include swap targets at qubit ${qi}, segment ${col}`);
        }
        ops.push({ gate, targets: [a, b], controls: controlIndices });
        continue;
      }

      if (gate === "OTHER") {
        if (!seg?.matrix) {
          throw new Error(`OTHER gate missing matrix at qubit ${qi}, segment ${col}`);
        }
        ops.push({ gate, target: qi, matrix: matrixFlow(seg.matrix), controls: controlIndices });
        continue;
      }

      throw new Error(`unsupported gate '${gate}' at qubit ${qi}, segment ${col}`);
    }

    if (ops.length === 0) continue;

    out += `  - id: v${vectorIndex++}\n`;
    out += "    operations:\n";

    const preOps = ops.filter((op) => op.gate !== "FX");
    const fxOps = ops.filter((op) => op.gate === "FX");

    if (fxStarted && preOps.length > 0) {
      throw new Error(`quantum operation not allowed after FX (segment ${col})`);
    }

    for (const op of preOps) {
      if (op.gate === "MEASURE") measured[op.target] = true;
    }

    for (const op of fxOps) {
      for (const bit of op.xBits) {
        if (!measured[bit]) {
          throw new Error(`FX requires x_bits to be measured before use (segment ${col})`);
        }
      }
    }

    for (const op of [...preOps, ...fxOps]) {
      out += `      - gate: ${op.gate}\n`;
      if (op.controls?.length > 0) {
        out += `        controls: [${op.controls.map((i) => `q${i}`).join(", ")}]\n`;
      }
      if (op.gate === "UF") {
        out += `        function: ${op.function}\n`;
        if (op.xBits.length > 0) {
          out += `        x_bits: [${op.xBits.map((i) => `q${i}`).join(", ")}]\n`;
        }
        out += `        y_bit: q${op.yBit}\n`;
      } else if (op.gate === "FX") {
        out += `        function: ${op.function}\n`;
        if (op.xBits.length > 0) {
          out += `        x_bits: [${op.xBits.map((i) => `q${i}`).join(", ")}]\n`;
        }
      } else {
        const targets = op.targets ?? [op.target];
        out += `        targets: [${targets.map((i) => `q${i}`).join(", ")}]\n`;
      }
      if (op.gate === "OTHER") {
        out += "        matrix:\n";
        out += `          values: ${op.matrix}\n`;
      }
    }

    if (fxOps.length > 0) fxStarted = true;
  }

  if (vectorIndex === 0) {
    out += "  - id: v0\n";
    out += "    operations:\n";
  }

  return out;
}

function buildUiConfigFromCircuitYamlText(yamlText) {
  const obj = YAML.parse(String(yamlText ?? ""));

  const qubitCountRaw = obj?.qubits ?? obj?.qubit_count;
  const qubitCount = mustNumber(qubitCountRaw, "qubits");
  if (!Number.isInteger(qubitCount) || qubitCount < 1 || qubitCount > 64) {
    throw new Error(`invalid qubit count: ${String(qubitCountRaw)}`);
  }

  const vectorsRaw = Array.isArray(obj?.vectors) ? obj.vectors : [];
  const vectorCount = Math.max(1, vectorsRaw.length);

  const config = {
    circuit: {
      description: "Imported from circuit YAML",
      qubits: []
    }
  };

  for (let i = 0; i < qubitCount; i++) {
    const segments = [];
    for (let col = 0; col < vectorCount; col++) {
      segments.push({ id: uuid(), gate: "none" });
    }
    config.circuit.qubits.push({
      id: `q${i}`,
      label: "|0>",
      y: 160 + i * ROW_GAP,
      segments
    });
  }

  const idToIndex = new Map();
  for (let i = 0; i < config.circuit.qubits.length; i++) idToIndex.set(config.circuit.qubits[i].id, i);

  function ensureEmpty(col, row, ctx) {
    const seg = config.circuit.qubits[row].segments[col];
    if (seg.gate && seg.gate !== "none") {
      throw new Error(`cannot import: multiple ops on q${row} in vector ${col} (${ctx})`);
    }
    return seg;
  }

  for (let col = 0; col < vectorsRaw.length; col++) {
    const v = vectorsRaw[col];
    const operations = Array.isArray(v?.operations) ? v.operations : [];

    for (const op of operations) {
      const gate = normalizeGate(op?.gate);
      if (!gate) continue;

      const controlsRaw = op?.controls;
      const controlList = Array.isArray(controlsRaw) ? controlsRaw : controlsRaw != null ? [controlsRaw] : [];
      const controlIds = [];
      const seen = new Set();
      for (const c of controlList) {
        const idx = parseQubitIndex(c);
        if (idx < 0 || idx >= qubitCount) throw new Error(`control out of range in vector ${col}`);
        const id = `q${idx}`;
        if (seen.has(id)) continue;
        seen.add(id);
        controlIds.push(id);
      }

      if (gate === "UF") {
        const func = String(op?.function ?? "parity").trim().toLowerCase();
        if (!["parity", "const0", "const1"].includes(func)) {
          throw new Error(`invalid UF function '${String(op?.function)}' in vector ${col}`);
        }

        const yBit = parseQubitIndex(op?.y_bit ?? (Array.isArray(op?.targets) ? op.targets[0] : op?.targets));
        if (yBit < 0 || yBit >= qubitCount) throw new Error(`UF y_bit out of range in vector ${col}`);

        const xbRaw = Array.isArray(op?.x_bits) ? op.x_bits : [];
        const xb = [];
        for (const x of xbRaw) {
          const idx = parseQubitIndex(x);
          if (idx < 0 || idx >= qubitCount) throw new Error(`UF x_bits out of range in vector ${col}`);
          if (idx === yBit) continue;
          xb.push(`q${idx}`);
        }

        const seg = ensureEmpty(col, yBit, "UF");
        seg.gate = "UF";
        seg.uf = { function: func, x_bits: xb };
        const nextControls = controlIds.filter((id) => id !== `q${yBit}`);
        if (nextControls.length > 0) seg.controls = nextControls;
        else delete seg.controls;
        continue;
      }

      if (gate === "FX") {
        if (controlIds.length > 0) {
          throw new Error(`FX does not support controls in vector ${col}`);
        }

        const func = String(op?.function ?? "parity").trim().toLowerCase();
        if (!["parity", "const0", "const1"].includes(func)) {
          throw new Error(`invalid FX function '${String(op?.function)}' in vector ${col}`);
        }

        const xbRaw = Array.isArray(op?.x_bits) ? op.x_bits : [];
        const xb = [];
        for (const x of xbRaw) {
          const idx = parseQubitIndex(x);
          if (idx < 0 || idx >= qubitCount) throw new Error(`FX x_bits out of range in vector ${col}`);
          xb.push(`q${idx}`);
        }

        let row = -1;
        for (let r = 0; r < qubitCount; r++) {
          const seg = config.circuit.qubits[r].segments[col];
          if (!seg.gate || seg.gate === "none") {
            row = r;
            break;
          }
        }
        if (row < 0) throw new Error(`cannot import: no empty row available for FX in vector ${col}`);

        const seg = ensureEmpty(col, row, "FX");
        seg.gate = "FX";
        seg.fx = { function: func, x_bits: xb };
        delete seg.controls;
        continue;
      }

      const targetsRaw = op?.targets;
      const targetList = Array.isArray(targetsRaw) ? targetsRaw : targetsRaw != null ? [targetsRaw] : [];
      const targets = targetList.map(parseQubitIndex);

      if (gate === "SWAP") {
        if (targets.length !== 2) throw new Error(`SWAP must have exactly 2 targets in vector ${col}`);
        const a = targets[0];
        const b = targets[1];
        if (a < 0 || a >= qubitCount || b < 0 || b >= qubitCount) {
          throw new Error(`SWAP target out of range in vector ${col}`);
        }
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        ensureEmpty(col, min, "SWAP");
        ensureEmpty(col, max, "SWAP");
        const seg = config.circuit.qubits[min].segments[col];
        seg.gate = "SWAP";
        seg.swapWith = `q${max}`;
        const nextControls = controlIds.filter((id) => id !== `q${min}` && id !== `q${max}`);
        if (nextControls.length > 0) seg.controls = nextControls;
        else delete seg.controls;
        continue;
      }

      if (gate === "OTHER") {
        if (targets.length !== 1) throw new Error(`OTHER must have 1 target in vector ${col}`);
        const t = targets[0];
        if (t < 0 || t >= qubitCount) throw new Error(`OTHER target out of range in vector ${col}`);

        const values = op?.matrix?.values ?? op?.values;
        if (!Array.isArray(values) || values.length !== 2) throw new Error(`OTHER missing 2x2 values in vector ${col}`);
        if (!Array.isArray(values[0]) || !Array.isArray(values[1])) throw new Error(`OTHER invalid values in vector ${col}`);

        function entry(r, c) {
          const cell = values?.[r]?.[c];
          if (cell != null && typeof cell === "object") {
            const re = mustNumber(cell.real ?? cell.re ?? 0, `OTHER.values[${r}][${c}].real`);
            const im = mustNumber(cell.imag ?? cell.im ?? 0, `OTHER.values[${r}][${c}].imag`);
            return { real: Math.abs(re) < 1e-15 ? 0 : re, imag: Math.abs(im) < 1e-15 ? 0 : im };
          }
          const re = mustNumber(cell ?? 0, `OTHER.values[${r}][${c}]`);
          return { real: Math.abs(re) < 1e-15 ? 0 : re, imag: 0 };
        }

        const seg = ensureEmpty(col, t, "OTHER");
        seg.gate = "OTHER";
        seg.matrix = {
          x1: entry(0, 0),
          x2: entry(0, 1),
          x3: entry(1, 0),
          x4: entry(1, 1)
        };
        const nextControls = controlIds.filter((id) => id !== `q${t}`);
        if (nextControls.length > 0) seg.controls = nextControls;
        else delete seg.controls;
        continue;
      }

      if (targets.length === 0) throw new Error(`gate ${gate} missing targets in vector ${col}`);

      for (const t of targets) {
        if (t < 0 || t >= qubitCount) throw new Error(`target out of range in vector ${col}`);
        const seg = ensureEmpty(col, t, gate);
        seg.gate = gate;
        delete seg.matrix;
        delete seg.uf;
        delete seg.fx;
        delete seg.swapWith;
        if (gate === "MEASURE" && controlIds.length > 0) {
          throw new Error(`MEASURE does not support controls in vector ${col}`);
        }
        const nextControls = controlIds.filter((id) => id !== `q${t}`);
        if (nextControls.length > 0) seg.controls = nextControls;
        else delete seg.controls;
      }
    }
  }

  return config;
}

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [output, setOutput] = useState("");
  const [runTimes, setRunTimes] = useState(25);
  const [batchRunning, setBatchRunning] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [functionToolOpen, setFunctionToolOpen] = useState(false);
  const [functionToolMode, setFunctionToolMode] = useState("UF");
  const [ufExpr, setUfExpr] = useState("x0 ^ x1");
  const [ufVarCount, setUfVarCount] = useState(2);
  const [ufValidation, setUfValidation] = useState({ ok: false, msg: "", truthTable: "" });
  const [shorN, setShorN] = useState(15);
  const [shorA, setShorA] = useState(2);
  const [shorAttempts, setShorAttempts] = useState(25);
  const [shorRunning, setShorRunning] = useState(false);
  const [shorResult, setShorResult] = useState(null);
  const [hoverSegment, setHoverSegment] = useState(null);
  const [activeSegment, setActiveSegment] = useState(null);
  const canvasRef = useRef(null);
  const [canvasRect, setCanvasRect] = useState(null);
  const [yamlImportOpen, setYamlImportOpen] = useState(false);
  const [yamlImportText, setYamlImportText] = useState("");
  const [yamlImportError, setYamlImportError] = useState("");

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data?.circuit?.qubits) {
          setConfig(data);
        } else {
          setConfig(defaultConfig);
        }
      })
      .catch(() => setConfig(defaultConfig));
  }, []);

  useEffect(() => {
    function updateRect() {
      if (!canvasRef.current) return;
      setCanvasRect(canvasRef.current.getBoundingClientRect());
    }

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, []);

  async function saveConfig(nextConfig = config) {
    setConfig(nextConfig);

    await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(nextConfig)
    });
  }

  function nextQubitId(qubits) {
    let maxIndex = -1;
    for (const q of qubits) {
      const match = /^q(\d+)$/.exec(q.id);
      if (!match) continue;
      const idx = Number(match[1]);
      if (Number.isFinite(idx)) maxIndex = Math.max(maxIndex, idx);
    }
    return `q${maxIndex + 1}`;
  }

  function addRow() {
    const nextConfig = structuredClone(config);
    const qubits = nextConfig.circuit.qubits;
    if (qubits.length >= 64) return;
    const lastQubit = qubits[qubits.length - 1];
    const nextId = nextQubitId(qubits);
    const nextY = lastQubit ? lastQubit.y + ROW_GAP : 160;

    qubits.push({
      id: nextId,
      label: "|0>",
      y: nextY,
      segments: [
        {
          id: crypto.randomUUID(),
          gate: "none"
        }
      ]
    });

    saveConfig(nextConfig);
  }

  function addSegment(qubitId) {
    const nextConfig = structuredClone(config);
    const qubit = nextConfig.circuit.qubits.find((q) => q.id === qubitId);
    if (!qubit) return;

    qubit.segments.push({
      id: crypto.randomUUID(),
      gate: "none"
    });

    saveConfig(nextConfig);
  }

  function addGate(qubitId, segmentId, gateType = "X") {
    const nextConfig = structuredClone(config);
    const qubit = nextConfig.circuit.qubits.find((q) => q.id === qubitId);
    if (!qubit) return;
    const segment = qubit.segments.find((s) => s.id === segmentId);
    if (!segment) return;
    const segmentIndex = qubit.segments.findIndex((s) => s.id === segmentId);

    function firstFxColumn(cfg) {
      let first = Infinity;
      for (const q of cfg.circuit.qubits) {
        const segs = Array.isArray(q?.segments) ? q.segments : [];
        for (let i = 0; i < segs.length; i++) {
          if (normalizeGate(segs[i]?.gate) === "FX") first = Math.min(first, i);
        }
      }
      return Number.isFinite(first) ? first : -1;
    }

    const fxCol = firstFxColumn(nextConfig);
    if (gateType !== "none" && gateType !== "FX" && fxCol !== -1 && segmentIndex > fxCol) {
      setOutput("Cannot add a quantum gate after FX.");
      return;
    }

    segment.gate = gateType;

    if (gateType === "none") {
      delete segment.matrix;
      delete segment.uf;
      delete segment.fx;
      delete segment.swapWith;
      delete segment.controls;
      saveConfig(nextConfig);
      return;
    }

    if (gateType === "OTHER") {
      segment.matrix = {
        x1: 1,
        x2: 0,
        x3: 0,
        x4: 1
      };
      delete segment.uf;
      delete segment.fx;
      delete segment.swapWith;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter((id) => id !== qubitId);
        if (segment.controls.length === 0) delete segment.controls;
      }
    } else if (gateType === "UF") {
      segment.uf =
        segment.uf ??
        ({
          function: "parity",
          x_bits: nextConfig.circuit.qubits
            .map((q) => q.id)
            .filter((id) => id !== qubitId)
        });
      delete segment.matrix;
      delete segment.fx;
      delete segment.swapWith;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter((id) => id !== qubitId);
        if (segment.controls.length === 0) delete segment.controls;
      }
    } else if (gateType === "FX") {
      const measuredIds = [];
      const seen = new Set();
      for (const q of nextConfig.circuit.qubits) {
        const segs = Array.isArray(q?.segments) ? q.segments : [];
        for (let col = 0; col < Math.min(segmentIndex, segs.length); col++) {
          if (normalizeGate(segs[col]?.gate) !== "MEASURE") continue;
          if (seen.has(q.id)) break;
          seen.add(q.id);
          measuredIds.push(q.id);
          break;
        }
      }

      segment.fx =
        segment.fx ??
        ({
          function: "parity",
          x_bits: measuredIds
        });
      delete segment.matrix;
      delete segment.uf;
      delete segment.swapWith;
      delete segment.controls;
    } else if (gateType === "SWAP") {
      const other = nextConfig.circuit.qubits.find((q) => q.id !== qubitId);
      segment.swapWith = other ? other.id : null;
      delete segment.matrix;
      delete segment.uf;
      delete segment.fx;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter(
          (id) => id !== qubitId && id !== segment.swapWith
        );
        if (segment.controls.length === 0) delete segment.controls;
      }
    } else if (gateType === "MEASURE") {
      delete segment.matrix;
      delete segment.uf;
      delete segment.fx;
      delete segment.swapWith;
      delete segment.controls;
    } else {
      delete segment.matrix;
      delete segment.uf;
      delete segment.fx;
      delete segment.swapWith;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter((id) => id !== qubitId);
        if (segment.controls.length === 0) delete segment.controls;
      }
    }

    saveConfig(nextConfig);
  }

  function deleteGate(qubitId, segmentId) {
    addGate(qubitId, segmentId, "none");
  }

  function deleteSegment(qubitId, segmentId) {
    const nextConfig = structuredClone(config);
    const qubit = nextConfig.circuit.qubits.find((q) => q.id === qubitId);
    if (!qubit) return;
    qubit.segments = qubit.segments.filter((s) => s.id !== segmentId);
    saveConfig(nextConfig);
  }

  function deleteRow(qubitId) {
    const nextConfig = structuredClone(config);
    nextConfig.circuit.qubits = nextConfig.circuit.qubits.filter(
      (q) => q.id !== qubitId
    );

    if (nextConfig.circuit.qubits.length === 0) {
      saveConfig(structuredClone(defaultConfig));
      return;
    }

    for (let i = 0; i < nextConfig.circuit.qubits.length; i++) {
      nextConfig.circuit.qubits[i].y = 160 + i * ROW_GAP;
    }

    saveConfig(nextConfig);
  }

	  function parseProgramText(text) {
	    const measurements = [];
	    const fxValues = [];

    for (const line of String(text).split(/\r?\n/)) {
      const t = line.trim();
      const m = /^measure q(\d+)\s*=\s*([01])\b/.exec(t);
      if (m) {
        measurements.push({ qubit: Number(m[1]), value: Number(m[2]) });
        continue;
      }

      const fx = /^fx(?:\[[^\]]+\])?\s*=\s*([01])\b/i.exec(t);
      if (fx) {
        fxValues.push(Number(fx[1]));
      }
    }

	    let bits = null;
	    if (measurements.length > 0) {
	      measurements.sort((a, b) => a.qubit - b.qubit);
	      bits = measurements.map((m) => String(m.value)).join("");
	    }

	    return { bits, fxValues, measurements };
	  }

	  async function runOnce({ seed } = {}) {
	    const init = { method: "POST" };
	    if (seed != null) {
	      init.headers = { "Content-Type": "application/json" };
	      init.body = JSON.stringify({ seed });
	    }
	    const res = await fetch("/api/run", init);
	    const data = await res.json();
	    const text = data.stdout || data.stderr || data.err || "";
	    return { text, ...parseProgramText(text) };
	  }

  async function runProgram() {
    const { text, bits, fxValues } = await runOnce();

    if (bits != null) {
      let out = bits;
      if (fxValues.length > 0) out += `\nf(x) = ${fxValues.join(", ")}`;
      setOutput(out);
    } else {
      setOutput(text);
    }
  }

  function formatCounts(counts, total) {
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries
      .map(([key, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
        return `${key}  ${count}  (${pct}%)`;
      })
      .join("\n");
  }

  async function runProgramBatch() {
    const nRaw = typeof runTimes === "number" ? runTimes : Number(runTimes);
    const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(500, Math.floor(nRaw))) : 1;

    setBatchRunning(true);
    try {
      const outputs = new Map();
      const fxOut = new Map();

      for (let i = 0; i < n; i++) {
        const { text, bits, fxValues } = await runOnce();
        if (bits == null) {
          setOutput(text || "No measurement output found.");
          return;
        }

        const key = bits;
        outputs.set(key, (outputs.get(key) ?? 0) + 1);

        if (fxValues.length > 0) {
          const fxKey = fxValues.length === 1 ? String(fxValues[0]) : fxValues.join(",");
          fxOut.set(fxKey, (fxOut.get(fxKey) ?? 0) + 1);
        }

        if ((i + 1) % 5 === 0 || i === n - 1) {
          let summary = `Runs: ${i + 1}/${n}\n\nOutputs:\n${formatCounts(outputs, i + 1)}`;
          if (fxOut.size > 0) summary += `\n\nf(x):\n${formatCounts(fxOut, i + 1)}`;
          setOutput(summary);
        }
      }
    } finally {
      setBatchRunning(false);
    }
  }

  function validateUf() {
    try {
      const truthTable = validateUfExpression(ufExpr, ufVarCount);
      setUfValidation({
        ok: true,
        msg: "Quantumly valid",
        truthTable
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUfValidation({
        ok: false,
        msg,
        truthTable: ""
      });
    }
  }

  function loadShorCircuitIntoEditor() {
    try {
      const yamlText = shor15CircuitYamlVectors({ N: shorN, a: shorA });
      const next = buildUiConfigFromCircuitYamlText(yamlText);
      saveConfig(next);
      setOutput(`Loaded Shor circuit (N=15, a=${shorA}). Click 'Run x times' to sample measurements.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutput(msg);
    }
  }

  async function runShor() {
    const N = Number(shorN);
    const a = Number(shorA);
    const attempts = Math.max(1, Math.min(200, Math.floor(Number(shorAttempts) || 25)));

    setShorRunning(true);
    setShorResult(null);
    try {
      const yamlText = shor15CircuitYamlVectors({ N, a });
      const next = buildUiConfigFromCircuitYamlText(yamlText);
      await saveConfig(next);

      const Q = 16;
      const histogram = new Map();

      for (let i = 0; i < attempts; i++) {
        const seed = 1 + i;
        const { measurements } = await runOnce({ seed });
        const c = measurementsToInt(measurements, [0, 1, 2, 3]);
        histogram.set(c, (histogram.get(c) ?? 0) + 1);

        const factored = tryFactor({ N, a, Q, c });
        if (factored) {
          const msg = `factors (base10): ${factored.factors.join(" × ")}\nN=${N}  a=${a}  r=${factored.r}  attempts=${i + 1}`;
          setOutput(msg);
          setShorResult({ ok: true, msg });
          return;
        }

        if ((i + 1) % 5 === 0 || i === attempts - 1) {
          const entries = Array.from(histogram.entries()).sort((x, y) => x[0] - y[0]);
          const histText = entries.map(([k, v]) => `${k}: ${v}`).join("  ");
          setOutput(`Shor runs: ${i + 1}/${attempts}\nN=${N}  a=${a}\n\nc histogram: ${histText}`);
        }
      }

      const entries = Array.from(histogram.entries()).sort((x, y) => x[0] - y[0]);
      const histText = entries.map(([k, v]) => `${k}: ${v}`).join("  ");
      const msg = `failed to recover non-trivial factors; try more attempts\nN=${N}  a=${a}\n\nc histogram: ${histText}`;
      setOutput(msg);
      setShorResult({ ok: false, msg });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutput(msg);
      setShorResult({ ok: false, msg });
    } finally {
      setShorRunning(false);
    }
  }

  function resetCircuit() {
    saveConfig(defaultConfig);
    setOutput("");
    setView({ x: 0, y: 0, scale: 1 });
    setActiveSegment(null);
  }

  function zoomIn() {
    setView((v) => ({ ...v, scale: Math.min(v.scale * 1.2, 4) }));
  }

  function zoomOut() {
    setView((v) => ({ ...v, scale: Math.max(v.scale / 1.2, 0.25) }));
  }

  function resetView() {
    setView({ x: 0, y: 0, scale: 1 });
  }

  function handleWheel(e) {
    e.preventDefault();

    const zoomAmount = e.deltaY < 0 ? 1.1 : 0.9;

    setView((v) => ({
      ...v,
      scale: Math.max(0.25, Math.min(4, v.scale * zoomAmount))
    }));
  }

  function handleMouseDown(e) {
    setActiveSegment(null);
    setDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
  }

  function handleMouseMove(e) {
    if (!dragging || !lastMouse) return;

    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;

    setView((v) => ({
      ...v,
      x: v.x + dx,
      y: v.y + dy
    }));

    setLastMouse({ x: e.clientX, y: e.clientY });
  }

  function handleMouseUp() {
    setDragging(false);
    setLastMouse(null);
  }

  const activeInfo = useMemo(() => {
    if (!activeSegment?.qubitId || !activeSegment?.segmentId) return null;
    const qubit = config.circuit.qubits.find((q) => q.id === activeSegment.qubitId);
    if (!qubit) return null;
    const segmentIndex = qubit.segments.findIndex((s) => s.id === activeSegment.segmentId);
    if (segmentIndex < 0) return null;
    const segment = qubit.segments[segmentIndex];

    const segmentX1 = START_X + segmentIndex * LINE_STEP;
    const segmentX2 = segmentX1 + LINE_STEP;
    const gateX = (segmentX1 + segmentX2) / 2;

    return { qubit, segment, segmentIndex, gateX };
  }, [activeSegment, config]);

  const popupStyle = useMemo(() => {
    if (!activeInfo || !canvasRect) return null;

    const gateScreenX = activeInfo.gateX * view.scale + view.x;
    const gateScreenY = activeInfo.qubit.y * view.scale + view.y;

    const popupWidth = 320;
    const estimatedHeight =
      activeInfo.segment.gate === "UF" ? 320 : activeInfo.segment.gate === "SWAP" ? 220 : 220;

    let left = canvasRect.left + gateScreenX;
    let top = canvasRect.top + gateScreenY - (BOX_SIZE * view.scale) / 2 - 12;
    let transform = "translate(-50%, -100%)";

    if (top - estimatedHeight < 8) {
      top = canvasRect.top + gateScreenY + (BOX_SIZE * view.scale) / 2 + 12;
      transform = "translate(-50%, 0%)";
    }

    const screenW = typeof window !== "undefined" ? window.innerWidth : popupWidth;
    const half = popupWidth / 2;
    left = Math.min(Math.max(left, half + 8), screenW - half - 8);

    return {
      ...styles.popup,
      position: "fixed",
      left,
      top,
      transform,
      width: popupWidth,
      zIndex: 10000
    };
  }, [activeInfo, canvasRect, view]);

  const qsimYamlPreview = useMemo(() => {
    try {
      return buildQsimYaml(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `# Error generating circuit YAML: ${msg}\n`;
    }
  }, [config]);

  const shorCircuitYamlPreview = useMemo(() => {
    try {
      return shor15CircuitYamlVectors({ N: shorN, a: shorA });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `# Error generating Shor circuit YAML: ${msg}\n`;
    }
  }, [shorN, shorA]);

  const controlOverlay = useMemo(() => {
    const qubits = config?.circuit?.qubits;
    if (!Array.isArray(qubits) || qubits.length === 0) return [];

    const idToY = new Map();
    for (const q of qubits) {
      if (q?.id && typeof q.y === "number") idToY.set(String(q.id), q.y);
    }

    const elements = [];

    for (let qi = 0; qi < qubits.length; qi++) {
      const q = qubits[qi];
      const segs = Array.isArray(q?.segments) ? q.segments : [];
      for (let col = 0; col < segs.length; col++) {
        const seg = segs[col];
        const gate = normalizeGate(seg?.gate);
        if (!gate) continue;

        const controls = uniqIds(seg?.controls);
        if (controls.length === 0) continue;

        const gateX = START_X + col * LINE_STEP + LINE_STEP / 2;

        const ys = [];
        const targetY = idToY.get(String(q.id));
        if (typeof targetY === "number") ys.push(targetY);

        if (gate === "SWAP" && seg?.swapWith) {
          const otherY = idToY.get(String(seg.swapWith));
          if (typeof otherY === "number") ys.push(otherY);
        }

        const controlYs = [];
        for (const cid of controls) {
          const cy = idToY.get(cid);
          if (typeof cy !== "number") continue;
          controlYs.push(cy);
          ys.push(cy);
        }

        if (ys.length < 2) continue;

        const yMin = Math.min(...ys);
        const yMax = Math.max(...ys);

        elements.push(
          <line
            key={`${q.id}:${seg.id}:ctrl-line`}
            x1={gateX}
            y1={yMin}
            x2={gateX}
            y2={yMax}
            stroke="#111"
            strokeWidth="2"
          />
        );

        for (const cy of controlYs) {
          elements.push(
            <circle
              key={`${q.id}:${seg.id}:ctrl-dot:${cy}`}
              cx={gateX}
              cy={cy}
              r="6"
              fill="#111"
            />
          );
        }
      }
    }

    return elements;
  }, [config]);

  const ufOverlay = useMemo(() => {
    const qubits = config?.circuit?.qubits;
    if (!Array.isArray(qubits) || qubits.length === 0) return [];

    const idToY = new Map();
    for (const q of qubits) {
      if (q?.id && typeof q.y === "number") idToY.set(String(q.id), q.y);
    }

    const elements = [];

    for (let qi = 0; qi < qubits.length; qi++) {
      const q = qubits[qi];
      const segs = Array.isArray(q?.segments) ? q.segments : [];
      for (let col = 0; col < segs.length; col++) {
        const seg = segs[col];
        const gate = normalizeGate(seg?.gate);
        if (gate !== "UF") continue;

        const gateX = START_X + col * LINE_STEP + LINE_STEP / 2;
        const targetY = idToY.get(String(q.id));
        if (typeof targetY !== "number") continue;

        const xIds = uniqIds(seg?.uf?.x_bits).filter((id) => id !== String(q.id));
        const xYs = [];
        for (const xid of xIds) {
          const y = idToY.get(xid);
          if (typeof y !== "number") continue;
          xYs.push(y);
        }
        if (xYs.length === 0) continue;

        const yMin = Math.min(targetY, ...xYs);
        const yMax = Math.max(targetY, ...xYs);

        elements.push(
          <line
            key={`${q.id}:${seg.id}:uf-line`}
            x1={gateX}
            y1={yMin}
            x2={gateX}
            y2={yMax}
            stroke="#4c6fff"
            strokeWidth="2"
          />
        );

        for (const y of xYs) {
          elements.push(
            <circle
              key={`${q.id}:${seg.id}:uf-x:${y}`}
              cx={gateX}
              cy={y}
              r="6"
              fill="#fff"
              stroke="#4c6fff"
              strokeWidth="2"
            />
          );
        }
      }
    }

    return elements;
  }, [config]);

  function openYamlImport() {
    setYamlImportError("");
    setYamlImportText(qsimYamlPreview);
    setYamlImportOpen(true);
  }

  function applyYamlImport() {
    try {
      const next = buildUiConfigFromCircuitYamlText(yamlImportText);
      saveConfig(next);
      setYamlImportOpen(false);
      setYamlImportError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setYamlImportError(msg);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.sidebar}>
        <h2>Quantum Diagram</h2>

        <button onClick={() => setLearnOpen(true)}>Learn</button>
        <button onClick={zoomOut}>Zoom Out</button>
        <button onClick={resetView}>Reset View</button>
        <button onClick={addRow}>Add Row</button>
        <button
          onClick={() => {
            setFunctionToolOpen(true);
          }}
        >
          Add f(x) or UF
        </button>
        <button onClick={runProgram} disabled={batchRunning}>
          Run C Program
        </button>
        <button onClick={resetCircuit}>Reset Circuit</button>

        <p>Zoom: {Math.round(view.scale * 100)}%</p>

        <h3>Circuit YAML (generated)</h3>
        <button onClick={openYamlImport} style={{ marginBottom: 8 }}>
          Import Circuit YAML
        </button>
        <pre style={styles.configBox}>{qsimYamlPreview}</pre>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: "bold" }}>UI config (YAML-backed JSON)</summary>
          <pre style={styles.configBox}>{JSON.stringify(config, null, 2)}</pre>
        </details>

        <h3>Measured Bits</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="number"
            min={1}
            max={500}
            value={runTimes}
            onChange={(e) => setRunTimes(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <button onClick={runProgramBatch} disabled={batchRunning}>
            Run x times
          </button>
        </div>
        <pre style={styles.outputBox}>{output}</pre>
      </div>

      <div
        ref={canvasRef}
        style={styles.canvas}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width="100%" height="100%">
          <defs>
            <pattern
              id="grid"
              width={50}
              height={50}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="#ddd"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            <rect
              x={-50000}
              y={-50000}
              width={100000}
              height={100000}
              fill="url(#grid)"
            />

            {config.circuit.qubits.map((qubit) => (
              <g key={qubit.id}>
                <text x={30} y={qubit.y + 5} fontSize="18">
                  {qubit.label}
                </text>

                {qubit.segments.map((segment, segmentIndex) => {
                  const segmentX1 = START_X + segmentIndex * LINE_STEP;
                  const segmentX2 = segmentX1 + LINE_STEP;
                  const gateX = (segmentX1 + segmentX2) / 2;

                  const isHovered = hoverSegment === segment.id;
                  const hasGate = segment.gate && segment.gate !== "none";
                  const isActive =
                    activeSegment?.qubitId === qubit.id &&
                    activeSegment?.segmentId === segment.id;
                  const gateLabel =
                    segment.gate === "MEASURE" ? "M" : segment.gate === "FX" ? "f" : segment.gate;

                  return (
                    <g
                      key={segment.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseEnter={() => setHoverSegment(segment.id)}
                      onMouseLeave={() => setHoverSegment(null)}
                    >
                      <line
                        x1={segmentX1}
                        y1={qubit.y}
                        x2={segmentX2}
                        y2={qubit.y}
                        stroke="black"
                        strokeWidth="3"
                      />

                      <rect
                        x={segmentX1}
                        y={qubit.y - 14}
                        width={segmentX2 - segmentX1}
                        height={28}
                        fill="transparent"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSegment({
                            qubitId: qubit.id,
                            segmentId: segment.id
                          });
                        }}
                      />

                      {hasGate && (
                        <g
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSegment({
                              qubitId: qubit.id,
                              segmentId: segment.id
                            });
                          }}
                        >
                          <rect
                            x={gateX - BOX_SIZE / 2}
                            y={qubit.y - BOX_SIZE / 2}
                            width={BOX_SIZE}
                            height={BOX_SIZE}
                            fill="white"
                            stroke={isActive ? "#4c6fff" : "black"}
                            strokeWidth={isActive ? "5" : "3"}
                          />

                          <text
                            x={gateX}
                            y={qubit.y + 7}
                            textAnchor="middle"
                            fontSize={gateLabel.length <= 2 ? 22 : 14}
                            fontWeight="bold"
                          >
                            {gateLabel}
                          </text>
                        </g>
                      )}

                      {isHovered && !hasGate && (
                        <foreignObject
                          x={gateX - 25}
                          y={qubit.y - 14}
                          width={50}
                          height={28}
                        >
                          <button
                            style={styles.inlineButton}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              addGate(qubit.id, segment.id, "X");
                            }}
                          >
                            +
                          </button>
                        </foreignObject>
                      )}
                    </g>
                  );
                })}

                <foreignObject
                  x={START_X + qubit.segments.length * LINE_STEP + 10}
                  y={qubit.y - 14}
                  width={75}
                  height={28}
                >
                  <button
                    style={styles.lineButton}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      addSegment(qubit.id);
                    }}
                  >
                    + Line
                  </button>
                </foreignObject>
              </g>
            ))}

            <g pointerEvents="none">
              {ufOverlay}
              {controlOverlay}
            </g>
          </g>
        </svg>

        {activeInfo && popupStyle && (() => {
          const { qubit, segment } = activeInfo;
          const hasGate = segment.gate && segment.gate !== "none";

          return (
            <div
              style={popupStyle}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
	              <div style={styles.popupRow}>
	                <span style={styles.popupLabel}>Gate</span>
	                <select
	                  style={styles.popupSelect}
	                  value={hasGate ? segment.gate : "none"}
                  onChange={(e) => {
                    addGate(qubit.id, segment.id, e.target.value);
                  }}
                >
                  {GATE_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g === "none" ? "(none)" : g}
                    </option>
                  ))}
	                </select>
	              </div>

                {hasGate && segment.gate !== "MEASURE" && segment.gate !== "FX" && (
                  <div style={styles.popupRow}>
                    <span style={styles.popupLabel}>Ctrl</span>
                    <select
                      style={{ ...styles.popupSelect, height: 110 }}
                      multiple
                      value={segment.controls ?? []}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                        const nextConfig = structuredClone(config);
                        const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                        const s = q?.segments.find((ss) => ss.id === segment.id);
                        if (!s) return;
                        const exclude = new Set([qubit.id]);
                        if (s.gate === "SWAP" && s.swapWith) exclude.add(String(s.swapWith));
                        const filtered = uniqIds(selected).filter((id) => !exclude.has(id));
                        if (filtered.length > 0) s.controls = filtered;
                        else delete s.controls;
                        saveConfig(nextConfig);
                      }}
                    >
                      {config.circuit.qubits
                        .map((qq) => qq.id)
                        .filter((id) => id !== qubit.id && !(segment.gate === "SWAP" && id === segment.swapWith))
                        .map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
	
                {segment.gate === "FX" && (
                  <>
                    <div style={styles.popupRow}>
                      <span style={styles.popupLabel}>f(x)</span>
                      <select
                        style={styles.popupSelect}
                        value={segment.fx?.function ?? "parity"}
                        onChange={(e) => {
                          const nextConfig = structuredClone(config);
                          const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                          const s = q?.segments.find((ss) => ss.id === segment.id);
                          if (!s) return;
                          s.fx = s.fx ?? { function: "parity", x_bits: [] };
                          s.fx.function = e.target.value;
                          saveConfig(nextConfig);
                        }}
                      >
                        <option value="parity">parity</option>
                        <option value="const0">const0</option>
                        <option value="const1">const1</option>
                      </select>
                    </div>

                    <div style={styles.popupRow}>
                      <span style={styles.popupLabel}>x</span>
                      <select
                        style={{ ...styles.popupSelect, height: 140 }}
                        multiple
                        value={segment.fx?.x_bits ?? []}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                          const nextConfig = structuredClone(config);
                          const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                          const s = q?.segments.find((ss) => ss.id === segment.id);
                          if (!s) return;
                          s.fx = s.fx ?? { function: "parity", x_bits: [] };
                          s.fx.x_bits = selected;
                          saveConfig(nextConfig);
                        }}
                      >
                        {config.circuit.qubits.map((qq) => (
                          <option key={qq.id} value={qq.id}>
                            {qq.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

	              {segment.gate === "UF" && (
	                <>
                  <div style={styles.popupRow}>
                    <span style={styles.popupLabel}>f(x)</span>
                    <select
                      style={styles.popupSelect}
                      value={segment.uf?.function ?? "parity"}
                      onChange={(e) => {
                        const nextConfig = structuredClone(config);
                        const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                        const s = q?.segments.find((ss) => ss.id === segment.id);
                        if (!s) return;
                        s.uf =
                          s.uf ??
                          ({
                            function: "parity",
                            x_bits: nextConfig.circuit.qubits
                              .map((qq) => qq.id)
                              .filter((id) => id !== qubit.id)
                          });
                        s.uf.function = e.target.value;
                        saveConfig(nextConfig);
                      }}
                    >
                      <option value="parity">parity</option>
                      <option value="const0">const0</option>
                      <option value="const1">const1</option>
                    </select>
                  </div>

                  <div style={styles.popupRow}>
                    <span style={styles.popupLabel}>x</span>
                    <select
                      style={{ ...styles.popupSelect, height: 140 }}
                      multiple
                      value={segment.uf?.x_bits ?? []}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                        const nextConfig = structuredClone(config);
                        const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                        const s = q?.segments.find((ss) => ss.id === segment.id);
                        if (!s) return;
                        s.uf =
                          s.uf ??
                          ({
                            function: "parity",
                            x_bits: nextConfig.circuit.qubits
                              .map((qq) => qq.id)
                              .filter((id) => id !== qubit.id)
                          });
                        s.uf.x_bits = selected;
                        saveConfig(nextConfig);
                      }}
                    >
                      {config.circuit.qubits
                        .filter((qq) => qq.id !== qubit.id)
                        .map((qq) => (
                          <option key={qq.id} value={qq.id}>
                            {qq.id}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}

              {segment.gate === "SWAP" && (
                <div style={styles.popupRow}>
                  <span style={styles.popupLabel}>With</span>
                  <select
                    style={styles.popupSelect}
                    value={segment.swapWith ?? ""}
                    onChange={(e) => {
                      const nextConfig = structuredClone(config);
                      const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                      const s = q?.segments.find((ss) => ss.id === segment.id);
                      if (!s) return;
                      s.swapWith = e.target.value || null;
                      saveConfig(nextConfig);
                    }}
                  >
                    {config.circuit.qubits
                      .filter((qq) => qq.id !== qubit.id)
                      .map((qq) => (
                        <option key={qq.id} value={qq.id}>
                          {qq.id}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div style={styles.popupButtons}>
                {hasGate && (
                  <button
                    style={styles.popupButton}
                    onClick={() => {
                      deleteGate(qubit.id, segment.id);
                      setActiveSegment(null);
                    }}
                  >
                    Delete gate
                  </button>
                )}
                <button
                  style={styles.popupButton}
                  onClick={() => {
                    deleteSegment(qubit.id, segment.id);
                    setActiveSegment(null);
                  }}
                >
                  Delete line
                </button>
                <button
                  style={styles.popupButton}
                  onClick={() => {
                    deleteRow(qubit.id);
                    setActiveSegment(null);
                  }}
                >
                  Delete row
                </button>
                <button style={styles.popupButton} onClick={() => setActiveSegment(null)}>
                  Close
                </button>
              </div>
            </div>
          );
        })()}

        {yamlImportOpen && (
          <div
            style={styles.modalOverlay}
            onMouseDown={() => setYamlImportOpen(false)}
          >
            <div
              style={styles.modal}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Import Circuit YAML</h3>
              <textarea
                style={styles.modalTextarea}
                value={yamlImportText}
                onChange={(e) => setYamlImportText(e.target.value)}
                spellCheck={false}
              />
              {yamlImportError && <pre style={styles.modalError}>{yamlImportError}</pre>}
              <div style={styles.modalButtons}>
                <button onClick={applyYamlImport}>Import</button>
                <button onClick={() => setYamlImportOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {functionToolOpen && (
          <div
            style={styles.modalOverlay}
            onMouseDown={() => setFunctionToolOpen(false)}
          >
            <div
              style={{ ...styles.modal, width: 560 }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Add f(x) or UF</h3>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: "bold" }}>Mode</span>
                <select
	                  value={functionToolMode}
	                  onChange={(e) => {
	                    setFunctionToolMode(e.target.value);
	                    setUfValidation({ ok: false, msg: "", truthTable: "" });
	                    setShorResult(null);
	                  }}
	                >
	                  <option value="UF">UF (boolean f(x))</option>
	                  <option value="SHOR">Shor (8 qubits, Circuit YAML)</option>
	                </select>
	              </div>

              {functionToolMode === "UF" && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: "bold", marginBottom: 6 }}>UF function</div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
                      Expression uses variables <code>x0</code>..<code>x7</code> with operators{" "}
                      <code>!</code>, <code>&amp;</code>, <code>^</code>, <code>|</code> and parentheses.
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <span style={{ width: 120 }}>x bit count</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={ufVarCount}
                        onChange={(e) => setUfVarCount(Number(e.target.value))}
                        style={{ width: 80 }}
                      />
                      <button onClick={validateUf}>Validate</button>
                    </div>

                    <textarea
                      value={ufExpr}
                      onChange={(e) => setUfExpr(e.target.value)}
                      spellCheck={false}
                      style={{ ...styles.modalTextarea, height: 80, marginBottom: 8 }}
                    />

                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: "bold" }}>Quantumly valid:</span>{" "}
                      {ufValidation.ok ? "yes" : "no"}
                    </div>

                    {ufValidation.msg && (
                      <pre style={ufValidation.ok ? styles.modalHint : styles.modalError}>{ufValidation.msg}</pre>
                    )}

                    {ufValidation.ok && ufValidation.truthTable && (
                      <pre style={styles.modalHint}>
                        truth table ({ufValidation.truthTable.length}): {ufValidation.truthTable}
                      </pre>
                    )}
                  </div>
                </>
              )}

	              {functionToolMode === "SHOR" && (
	                <>
	                  <div style={{ fontWeight: "bold", marginBottom: 6 }}>Shor (8 qubits → Circuit YAML)</div>
	                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
	                    Generates a compiled circuit for <code>N=15</code> and loads it into the editor. Supported{" "}
	                    <code>a</code> values: <code>2</code> or <code>8</code>.
	                  </div>

	                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
	                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
	                      <span style={{ width: 26 }}>N</span>
	                      <input
	                        type="number"
	                        value={shorN}
                        onChange={(e) => setShorN(Number(e.target.value))}
                        style={{ width: 90 }}
	                      />
	                    </label>
	                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
	                      <span style={{ width: 26 }}>a</span>
	                      <input
                        type="number"
                        value={shorA}
                        onChange={(e) => setShorA(Number(e.target.value))}
                        style={{ width: 90 }}
	                      />
	                    </label>
	                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
	                      <span style={{ width: 70 }}>attempts</span>
	                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={shorAttempts}
	                        onChange={(e) => setShorAttempts(Number(e.target.value))}
	                        style={{ width: 90 }}
	                      />
		                    </label>
		                    <button onClick={loadShorCircuitIntoEditor} disabled={shorRunning}>
		                      Load circuit
		                    </button>
		                    <button onClick={runShor} disabled={shorRunning}>
		                      {shorRunning ? "Running..." : "Run Shor"}
		                    </button>
		                  </div>

	                  <textarea
	                    value={shorCircuitYamlPreview}
	                    readOnly
	                    spellCheck={false}
	                    style={{ ...styles.modalTextarea, height: 200, marginBottom: 8 }}
	                  />

	                  {shorResult && (
	                    <pre style={shorResult.ok ? styles.modalHint : styles.modalError}>{shorResult.msg ?? ""}</pre>
	                  )}
	                </>
	              )}

              <div style={styles.modalButtons}>
                <button onClick={() => setFunctionToolOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {learnOpen && (
          <div style={styles.modalOverlay} onMouseDown={() => setLearnOpen(false)}>
            <div
              style={{
                ...styles.modal,
                width: "92vw",
                height: "92vh",
                maxWidth: 1400,
                maxHeight: "92vh",
                display: "flex",
                flexDirection: "column",
                padding: 12
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h3 style={{ margin: 0 }}>Learn</h3>
                <button onClick={() => setLearnOpen(false)}>Close</button>
              </div>
              <div style={{ flex: 1, marginTop: 10, border: "2px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
                <iframe
                  title="Quantum Info Page"
                  srcDoc={infoPageHtml}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  sandbox="allow-scripts allow-forms allow-popups"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    height: "100vh",
    fontFamily: "Arial, sans-serif"
  },
  sidebar: {
    width: "320px",
    padding: "16px",
    borderRight: "2px solid #ddd",
    background: "#f4f4f4",
    overflow: "auto"
  },
  canvas: {
    flex: 1,
    background: "#eaeaea",
    cursor: "grab",
    overflow: "hidden"
  },
  inlineButton: {
    width: "50px",
    height: "26px",
    fontSize: "16px",
    cursor: "pointer",
    background: "white",
    border: "2px solid black",
    borderRadius: "6px"
  },
  lineButton: {
    width: "70px",
    height: "26px",
    fontSize: "12px",
    cursor: "pointer"
  },
  configBox: {
    background: "white",
    padding: "10px",
    fontSize: "12px",
    maxHeight: "260px",
    overflow: "auto"
  },
  outputBox: {
    background: "black",
    color: "lime",
    padding: "10px",
    fontSize: "12px",
    minHeight: "120px",
    overflow: "auto"
  },
  popup: {
    background: "white",
    border: "2px solid black",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "12px",
    boxShadow: "0 10px 24px rgba(0,0,0,0.25)"
  },
  popupRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px"
  },
  popupLabel: {
    fontWeight: "bold",
    width: "40px"
  },
  popupSelect: {
    flex: 1,
    height: "28px"
  },
  popupButtons: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px"
  },
  popupButton: {
    height: "28px",
    cursor: "pointer"
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    zIndex: 20000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px"
  },
  modal: {
    width: "min(900px, 95vw)",
    background: "white",
    borderRadius: "12px",
    border: "2px solid #111",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    padding: "16px"
  },
  modalTextarea: {
    width: "100%",
    height: "50vh",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    resize: "vertical"
  },
  modalError: {
    background: "#2b0000",
    color: "#ffd6d6",
    padding: "10px",
    borderRadius: "8px",
    overflow: "auto",
    maxHeight: "140px"
  },
  modalHint: {
    background: "#f3f3f3",
    color: "#111",
    padding: "10px",
    borderRadius: "8px",
    overflow: "auto",
    maxHeight: "240px"
  },
  modalButtons: {
    marginTop: "10px",
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end"
  }
};
