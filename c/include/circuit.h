#ifndef CIRCUIT_H
#define CIRCUIT_H

#include <stddef.h>

#include "gates.h"
#include "quantum.h"
#include "uf.h"

typedef struct {
    GateKind kind;
    Matrix2 other_matrix;

    int *targets;
    size_t target_count;

    int *controls;
    size_t control_count;

    struct {
        UfFunction function;
        int *x_bits;
        size_t x_bit_count;
    } fx;

    struct {
        UfFunction function;
        int *x_bits;
        size_t x_bit_count;
        int y_bit;
    } uf;
} CircuitOp;

typedef struct {
    int qubit_count;
    CircuitOp *ops;
    size_t op_count;
} Circuit;

int circuit_load_yaml_file(const char *path, Circuit *out_circuit, char **out_error);
void circuit_free(Circuit *circuit);

size_t circuit_step_count(const Circuit *circuit);

#endif
