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

Run:

```sh
./c/build/bin/qsim path/to/circuit.yaml
```

Print every intermediate state:

```sh
./c/build/bin/qsim path/to/circuit.yaml --steps
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

Or:

```sh
./server/scripts/run.sh
```

## Client (scaffold)

```sh
npm install
npm run client
```

## Nix

```sh
nix-shell --run "make test"
```
