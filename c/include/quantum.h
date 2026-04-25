#ifndef QUANTUM_H
#define QUANTUM_H

#include <stddef.h>
#include <stdint.h>

#include "uf.h"

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

int qs_apply_uf(QuantumState *state,
                UfFunction function,
                const int *x_bits,
                size_t x_bit_count,
                int y_bit,
                const int *controls,
                size_t control_count,
                Complex *scratch);

int qs_measure(QuantumState *state,
               int qubit,
               uint64_t *rng_state,
               int *out_value,
               double *out_p0,
               double *out_p1);

double qs_norm2(const QuantumState *state);

#endif
