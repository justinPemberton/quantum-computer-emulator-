import React, { useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";

const BOX_SIZE = 50;
const LINE_STEP = 140;
const ROW_GAP = 90;
const START_X = 80;

const GATE_OPTIONS = ["none", "H", "X", "Y", "Z", "S", "T", "MEASURE", "UF", "SWAP", "OTHER"];

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

function matrixFlow({ x1, x2, x3, x4 }) {
  const a = mustNumber(x1, "matrix.x1");
  const b = mustNumber(x2, "matrix.x2");
  const c = mustNumber(x3, "matrix.x3");
  const d = mustNumber(x4, "matrix.x4");
  return `[[{real:${a}, imag:0}, {real:${b}, imag:0}], [{real:${c}, imag:0}, {real:${d}, imag:0}]]`;
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

    for (const op of ops) {
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
          const cell = values?.[r]?.[c] ?? {};
          const re = mustNumber(cell.real ?? 0, `OTHER.values[${r}][${c}].real`);
          const im = mustNumber(cell.imag ?? 0, `OTHER.values[${r}][${c}].imag`);
          if (im !== 0) throw new Error("OTHER import only supports imag: 0");
          return re;
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

    segment.gate = gateType;

    if (gateType === "none") {
      delete segment.matrix;
      delete segment.uf;
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
      delete segment.swapWith;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter((id) => id !== qubitId);
        if (segment.controls.length === 0) delete segment.controls;
      }
    } else if (gateType === "SWAP") {
      const other = nextConfig.circuit.qubits.find((q) => q.id !== qubitId);
      segment.swapWith = other ? other.id : null;
      delete segment.matrix;
      delete segment.uf;
      if (Array.isArray(segment.controls)) {
        segment.controls = segment.controls.filter(
          (id) => id !== qubitId && id !== segment.swapWith
        );
        if (segment.controls.length === 0) delete segment.controls;
      }
    } else if (gateType === "MEASURE") {
      delete segment.matrix;
      delete segment.uf;
      delete segment.swapWith;
      delete segment.controls;
    } else {
      delete segment.matrix;
      delete segment.uf;
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

  async function runProgram() {
    const res = await fetch("/api/run", { method: "POST" });
    const data = await res.json();
    const text = data.stdout || data.stderr || data.err || "";

    const measurements = [];
    for (const line of String(text).split(/\r?\n/)) {
      const match = /^measure q(\d+)\s*=\s*([01])\b/.exec(line.trim());
      if (!match) continue;
      measurements.push({ qubit: Number(match[1]), value: Number(match[2]) });
    }

    if (measurements.length > 0) {
      measurements.sort((a, b) => a.qubit - b.qubit);
      const bits = measurements.map((m) => String(m.value)).join("");
      setOutput(bits);
    } else {
      setOutput(text);
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

        <button onClick={zoomIn}>Zoom In</button>
        <button onClick={zoomOut}>Zoom Out</button>
        <button onClick={resetView}>Reset View</button>
        <button onClick={addRow}>Add Row</button>
        <button onClick={runProgram}>Run C Program</button>
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
                  const gateLabel = segment.gate === "MEASURE" ? "M" : segment.gate;

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

                {hasGate && segment.gate !== "MEASURE" && (
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
  modalButtons: {
    marginTop: "10px",
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end"
  }
};
