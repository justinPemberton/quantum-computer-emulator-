# quantum-computer-emulator

State-vector quantum circuit simulator with a C core plus server/client scaffolding.

## Requirements

- For the C core: a C compiler (`gcc`/`clang`) and `make` (or Nix)
- For server/client: Node.js + npm (or Nix)

## Build

```sh
make
```

## Run (example)

```sh
./c/build/bin/qsim
```

## Run a YAML circuit

Example format (subset of YAML):

```yaml
qubits: 2
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
```

Supported gates:

- 1-qubit: `H`, `X`, `Y`, `Z`, `S`, `T`
- `SWAP` (2 targets)
- `OTHER` (custom 2×2 matrix)
- `UF` oracle: `y_bit: qN`, optional `x_bits: [...]`, `function: parity|const0|const1`
- `MEASURE` (collapses the state and prints a readout line)
- `FX` (classical f(x) transform): `function: parity|const0|const1`, optional `x_bits: [...]` (must be measured before use). Prints an `fx = 0|1` line. No quantum ops are allowed after `FX`.

Example `UF` + `MEASURE`:

```yaml
qubits: 2
vectors:
  - id: v0
    operations:
      - gate: H
        targets: [q0]
      - gate: UF
        function: parity
        x_bits: [q0]
        y_bit: q1
      - gate: MEASURE
        targets: [q1]
```

Run:

```sh
./c/build/bin/qsim path/to/circuit.yaml
```

Print every intermediate state:

```sh
./c/build/bin/qsim path/to/circuit.yaml --steps
```

Measurement randomness is controlled by `QSIM_SEED`:

- unset: seed from OS entropy (random each run)
- set to an integer: deterministic/reproducible runs

## Examples

Deutsch–Jozsa (10 total qubits: inputs `q0..q8`, ancilla `q9`):

```sh
./c/build/bin/qsim c/examples/deutsch_jozsa_10q_const0.yaml
./c/build/bin/qsim c/examples/deutsch_jozsa_10q_parity.yaml
```

Deutsch (2 qubits: input `q0`, ancilla `q1`):

```sh
./c/build/bin/qsim c/examples/deutsch_2q_const0.yaml
./c/build/bin/qsim c/examples/deutsch_2q_const1.yaml
./c/build/bin/qsim c/examples/deutsch_2q_balanced_x.yaml
./c/build/bin/qsim c/examples/deutsch_2q_balanced_notx.yaml
```

## Design

See `DESIGN.md`.

## Test

```sh
make test
```

## Server (scaffold)

```sh
npm install
npm run server
```

Run the simulator once (prints amplitudes to stdout):

```sh
./server/scripts/run.sh
```

## Client (UI)

```sh
npm install
npm run client
```

## Dev (server + client)

```sh
npm install
npm run dev
```

## Nix

```sh
nix-shell
```
<img width="2560" height="1436" alt="image" src="https://github.com/user-attachments/assets/4983bdba-6948-474b-8e53-299157585b4e" />
