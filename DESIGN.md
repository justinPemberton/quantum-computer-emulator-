# Quantum Circuit Simulator — Design Document

## 1. Overview

This project implements a classical simulation of quantum circuits using:

- State vector representation
- 2×2 matrices for single-qubit gates
- Bitwise/index manipulation for multi-qubit operations
- YAML for circuit definition
- Optional binary format for fast execution

## 2. Core Design Philosophy

Keep math small, move data smart.

- Only the state vector grows (2^n)
- All gates remain:
  - 2×2 matrices
  - OR logic-based transformations
- Avoid large matrix multiplication (RAM stays alive)

## 3. System Architecture

YAML Input → Parser → Gate + Targets + Controls → Execution Engine → Quantum State Update

## 4. Data Structures

### 4.1 Complex Number

```c
typedef struct {
    double real;
    double imag;
} Complex;
```

### 4.2 Matrix (2×2 only)

```c
typedef struct {
    Complex values[4]; // row-major: [a, b, c, d]
} Matrix;
```

Represents:

```
[a b]
[c d]
```

### 4.3 Quantum State

```c
typedef struct {
    int qubit_count;
    size_t size;     // 2^qubit_count
    Complex *data;   // state vector
} QuantumState;
```

## 5. Gate System

### 5.1 Standard Gates (Hardcoded)

- I, X, Y, Z
- H
- S, T
- Rx, Ry, Rz

Stored as 2×2 matrices.

### 5.2 Controlled Gates

Implemented via control bits + conditional execution (not via matrices).

Examples:

- CNOT → X + control
- CCNOT → X + 2 controls
- Controlled-H → H + control

### 5.3 SWAP Gate

Implemented via bit index swapping (not matrix multiplication).

### 5.4 Custom Gates

Defined by user as:

```yaml
matrix:
  values: [...]
```

Must be a 2×2 matrix only.

### 5.5 Oracle Gate (U_f)

Implements:

```
U_f|x,y⟩ = |x, y ⊕ f(x)⟩
```

Implemented as:

- Extract bits from index
- Compute f(x)
- XOR target bit
- Move amplitude

## 6. Execution Model

### 6.1 Main Loop

```
for each vector step:
    for each operation:
        apply operation to state
```

### 6.2 Single-Qubit Gate Application

- Pair amplitudes differing in one bit
- Apply 2×2 matrix

### 6.3 Controlled Gate

```
If control bits == 1:
    apply gate
Else:
    skip
```

### 6.4 SWAP

Swap amplitudes where bit positions differ.

### 6.5 U_f

Remap indices using XOR logic.

## 7. YAML Circuit Format

Example:

```yaml
qubits: 3

vectors:
  - id: v0
    operations:
      - gate: H
        targets: [q0]

  - id: v1
    operations:
      - gate: X
        controls: [q0]
        targets: [q1]

  - id: v2
    operations:
      - gate: SWAP
        targets: [q1, q2]

  - id: v3
    operations:
      - gate: UF
        function: parity
        x_bits: [q0, q1]
        y_bit: q2
```

## 8. Binary Format (Optional)

Used for faster execution.

Structure:

- `[Header]`
- `[Gate Instructions...]`

Header:

```c
typedef struct {
    int magic;      // file ID
    int version;
    int qubits;
    int steps;
} Header;
```

## 9. Complexity

- Time: `O(gates × 2^n)`
- Memory: `O(2^n)`

Example:

- 30 qubits ≈ 16 GB RAM

## 10. Limits

- Exponential scaling (not avoidable)
- Floating-point precision errors
- No noise model (pure state only)
- No measurement collapse yet (optional feature)

## 11. Future Extensions

- Measurement system
- Density matrices (for noise)
- Gate decomposition
- GPU acceleration
- Circuit optimization
- Distributed simulation

## 12. Key Design Decisions

| Decision | Reason |
|---|---|
| Only 2×2 matrices | avoids exponential explosion |
| No large gate matrices | memory efficiency |
| Controlled gates via logic | speed + simplicity |
| YAML input | human-readable |
| Binary output | performance |

## Final Summary

- State = big
- Gates = small
- Controls = logic
- Simulation = index manipulation

