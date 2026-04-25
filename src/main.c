#include "circuit.h"
#include "gates.h"
#include "quantum.h"
#include "sim.h"

#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_basis_state(size_t index, int qubits)
{
    putchar('|');
    for (int q = qubits - 1; q >= 0; q--) {
        putchar(((index >> (unsigned)q) & 1U) ? '1' : '0');
    }
    putchar('>');
}

static void print_state(const QuantumState *state)
{
    const double eps = 1e-12;
    for (size_t i = 0; i < state->size; i++) {
        double re = state->data[i].real;
        double im = state->data[i].imag;
        if (fabs(re) < eps && fabs(im) < eps) continue;
        print_basis_state(i, state->qubit_count);
        printf("  %.12f%+.12fi\n", re, im);
    }
}

static void usage(const char *argv0)
{
    fprintf(stderr, "usage: %s [circuit.yaml] [--steps]\n", argv0);
}

static int run_builtin_bell(void)
{
    QuantumState state;
    if (qs_init(&state, 2) != 0) return 1;

    Complex *scratch = malloc(state.size * sizeof(Complex));
    if (!scratch) {
        qs_free(&state);
        return 1;
    }

    if (qs_apply_single_qubit_gate(&state, gate_standard_matrix(GATE_H), 0, scratch) != 0) goto fail;
    int controls[] = {0};
    if (qs_apply_controlled_gate(&state, gate_standard_matrix(GATE_X), 1, controls, 1, scratch) != 0) goto fail;

    printf("Bell state (2 qubits):\n");
    print_state(&state);
    printf("norm^2 = %.12f\n", qs_norm2(&state));

    free(scratch);
    qs_free(&state);
    return 0;

fail:
    free(scratch);
    qs_free(&state);
    return 1;
}

int main(int argc, char **argv)
{
    const char *path = NULL;
    bool steps = false;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--steps") == 0) {
            steps = true;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            usage(argv[0]);
            return 0;
        } else if (argv[i][0] == '-') {
            usage(argv[0]);
            return 2;
        } else {
            path = argv[i];
        }
    }

    if (!path) return run_builtin_bell();

    Circuit circuit;
    char *error = NULL;
    if (circuit_load_yaml_file(path, &circuit, &error) != 0) {
        fprintf(stderr, "failed to parse circuit: %s\n", error ? error : "unknown error");
        free(error);
        return 1;
    }

    QuantumState state;
    if (qs_init(&state, circuit.qubit_count) != 0) {
        fprintf(stderr, "failed to allocate state\n");
        circuit_free(&circuit);
        return 1;
    }

    Complex *scratch = malloc(state.size * sizeof(Complex));
    if (!scratch) {
        fprintf(stderr, "failed to allocate scratch\n");
        qs_free(&state);
        circuit_free(&circuit);
        return 1;
    }

    StateHistory history;
    StateHistory *history_ptr = steps ? &history : NULL;
    if (sim_run(&circuit, &state, scratch, history_ptr) != 0) {
        fprintf(stderr, "simulation failed\n");
        if (history_ptr) sim_history_free(history_ptr);
        free(scratch);
        qs_free(&state);
        circuit_free(&circuit);
        return 1;
    }

    if (history_ptr) {
        for (size_t i = 0; i < history_ptr->count; i++) {
            printf("step %zu:\n", i);
            print_state(&history_ptr->states[i]);
        }
        sim_history_free(history_ptr);
    } else {
        print_state(&state);
    }
    printf("norm^2 = %.12f\n", qs_norm2(&state));

    free(scratch);
    qs_free(&state);
    circuit_free(&circuit);
    return 0;
}
