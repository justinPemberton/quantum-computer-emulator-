# quantum-computer-emulator (C)

Minimal state-vector simulator for small quantum circuits.

## Requirements

- A C compiler (`gcc`/`clang`) and `make`
- Or Nix (example below)

## Build

```sh
make
```

## Run (example)

```sh
./build/bin/qsim
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
./build/bin/qsim path/to/circuit.yaml
```

Print every intermediate state:

```sh
./build/bin/qsim path/to/circuit.yaml --steps
```

## Design

See `DESIGN.md`.

## Test

```sh
make test
```

## Nix (optional)

```sh
nix-shell -p gcc gnumake --run "make test"
```
