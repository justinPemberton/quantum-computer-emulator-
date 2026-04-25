#ifndef QUANTUM_H
#define QUANTUM_H

#include <stddef.h>

typedef struct {
    double real;
    double imag;
} Complex;

typedef struct {
    Complex values[4];
} Matrix2;

typedef struct {
    int qubit_count;
    size_t size;
    Complex *data;
} QuantumState;

int qs_init(QuantumState *state, int qubit_count);
void qs_free(QuantumState *state);

int qs_apply_single_qubit_gate(QuantumState *state, const Matrix2 *u, int target, Complex *scratch);
int qs_apply_controlled_gate(QuantumState *state,
                             const Matrix2 *u,
                             int target,
                             const int *controls,
                             size_t control_count,
                             Complex *scratch);
int qs_apply_swap(QuantumState *state,
                  int q1,
                  int q2,
                  const int *controls,
                  size_t control_count,
                  Complex *scratch);

double qs_norm2(const QuantumState *state);

#endif

