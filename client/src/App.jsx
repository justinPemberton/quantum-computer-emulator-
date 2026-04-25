import React, { useEffect, useState } from "react";

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

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [output, setOutput] = useState("");
  const [hoverSegment, setHoverSegment] = useState(null);
  const [activeSegment, setActiveSegment] = useState(null);

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

    if (gateType === "OTHER") {
      segment.matrix = {
        x1: 1,
        x2: 0,
        x3: 0,
        x4: 1
      };
      delete segment.uf;
      delete segment.swapWith;
    } else if (gateType === "UF") {
      segment.uf = segment.uf ?? { function: "parity", x_bits: [] };
      delete segment.matrix;
      delete segment.swapWith;
    } else if (gateType === "SWAP") {
      const other = nextConfig.circuit.qubits.find((q) => q.id !== qubitId);
      segment.swapWith = other ? other.id : null;
      delete segment.matrix;
      delete segment.uf;
    } else {
      delete segment.matrix;
      delete segment.uf;
      delete segment.swapWith;
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
    setOutput(data.stdout || data.stderr || data.err || "");
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

        <h3>YAML-backed JSON</h3>
        <pre style={styles.configBox}>{JSON.stringify(config, null, 2)}</pre>

        <h3>Program Output</h3>
        <pre style={styles.outputBox}>{output}</pre>
      </div>

      <div
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
                            stroke="black"
                            strokeWidth="3"
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

                      {isActive && (
                        <foreignObject
                          x={gateX - 105}
                          y={qubit.y - BOX_SIZE / 2 - 95}
                          width={210}
                          height={segment.gate === "UF" ? 240 : segment.gate === "SWAP" ? 180 : 140}
                        >
                          <div
                            style={styles.popup}
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
                                      s.uf = s.uf ?? { function: "parity", x_bits: [] };
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
                                    style={{ ...styles.popupSelect, height: 90 }}
                                    multiple
                                    value={segment.uf?.x_bits ?? []}
                                    onChange={(e) => {
                                      const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                                      const nextConfig = structuredClone(config);
                                      const q = nextConfig.circuit.qubits.find((qq) => qq.id === qubit.id);
                                      const s = q?.segments.find((ss) => ss.id === segment.id);
                                      if (!s) return;
                                      s.uf = s.uf ?? { function: "parity", x_bits: [] };
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
                              <button
                                style={styles.popupButton}
                                onClick={() => setActiveSegment(null)}
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        </foreignObject>
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
          </g>
        </svg>
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
  }
};
