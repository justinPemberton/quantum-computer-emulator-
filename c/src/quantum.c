#include "quantum.h"

#include <limits.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static inline Complex complex_add(Complex a, Complex b)
{
    return (Complex){.real = a.real + b.real, .imag = a.imag + b.imag};
}

static inline Complex complex_mul(Complex a, Complex b)
{
    return (Complex){
        .real = a.real * b.real - a.imag * b.imag,
        .imag = a.real * b.imag + a.imag * b.real,
    };
}

static inline bool is_valid_qubit_index(const QuantumState *state, int q)
{
    return state && q >= 0 && q < state->qubit_count;
}

static int build_control_mask(const QuantumState *state,
                              const int *controls,
                              size_t control_count,
                              int forbidden0,
                              int forbidden1,
                              size_t *out_mask)
{
    if (!out_mask) return -1;
    *out_mask = 0;

    for (size_t i = 0; i < control_count; i++) {
        int q = controls[i];
        if (!is_valid_qubit_index(state, q)) return -1;
        if (q == forbidden0 || q == forbidden1) return -1;
        *out_mask |= (size_t)1U << (unsigned)q;
    }

    return 0;
}

int qs_init(QuantumState *state, int qubit_count)
{
    if (!state) return -1;
    state->qubit_count = 0;
    state->size = 0;
    state->data = NULL;

    if (qubit_count < 0) return -1;
    if (qubit_count >= (int)(sizeof(size_t) * CHAR_BIT)) return -1;

    size_t size = (size_t)1ULL << (unsigned)qubit_count;
    if (size == 0) return -1;
    if (size > SIZE_MAX / sizeof(Complex)) return -1;

    Complex *data = calloc(size, sizeof(Complex));
    if (!data) return -1;
    data[0].real = 1.0;

    state->qubit_count = qubit_count;
    state->size = size;
    state->data = data;
    return 0;
}

void qs_free(QuantumState *state)
{
    if (!state) return;
    free(state->data);
    state->data = NULL;
    state->size = 0;
    state->qubit_count = 0;
}

int qs_apply_single_qubit_gate(QuantumState *state, const Matrix2 *u, int target, Complex *scratch)
{
    if (!state || !state->data || !u) return -1;
    if (!is_valid_qubit_index(state, target)) return -1;

    size_t n = state->size;

    bool should_free = false;
    Complex *old = scratch;
    if (!old) {
        old = malloc(n * sizeof(Complex));
        if (!old) return -1;
        should_free = true;
    }

    memcpy(old, state->data, n * sizeof(Complex));

    size_t half_block = (size_t)1ULL << (unsigned)target;
    size_t full_block = half_block << 1U;

    Complex u00 = u->values[0];
    Complex u01 = u->values[1];
    Complex u10 = u->values[2];
    Complex u11 = u->values[3];

    for (size_t block_start = 0; block_start < n; block_start += full_block) {
        for (size_t offset = 0; offset < half_block; offset++) {
            size_t i0 = block_start + offset;
            size_t i1 = i0 + half_block;

            Complex a0 = old[i0];
            Complex a1 = old[i1];

            state->data[i0] = complex_add(complex_mul(u00, a0), complex_mul(u01, a1));
            state->data[i1] = complex_add(complex_mul(u10, a0), complex_mul(u11, a1));
        }
    }

    if (should_free) free(old);
    return 0;
}

int qs_apply_controlled_gate(QuantumState *state,
                             const Matrix2 *u,
                             int target,
                             const int *controls,
                             size_t control_count,
                             Complex *scratch)
{
    if (!state || !state->data || !u) return -1;
    if (!is_valid_qubit_index(state, target)) return -1;
    if (control_count > 0 && !controls) return -1;

    size_t control_mask = 0;
    if (build_control_mask(state, controls, control_count, target, -1, &control_mask) != 0) return -1;

    size_t n = state->size;

    bool should_free = false;
    Complex *old = scratch;
    if (!old) {
        old = malloc(n * sizeof(Complex));
        if (!old) return -1;
        should_free = true;
    }
    memcpy(old, state->data, n * sizeof(Complex));

    size_t half_block = (size_t)1ULL << (unsigned)target;
    size_t full_block = half_block << 1U;

    Complex u00 = u->values[0];
    Complex u01 = u->values[1];
    Complex u10 = u->values[2];
    Complex u11 = u->values[3];

    for (size_t block_start = 0; block_start < n; block_start += full_block) {
        for (size_t offset = 0; offset < half_block; offset++) {
            size_t i0 = block_start + offset;
            if ((i0 & control_mask) != control_mask) continue;
            size_t i1 = i0 + half_block;

            Complex a0 = old[i0];
            Complex a1 = old[i1];

            state->data[i0] = complex_add(complex_mul(u00, a0), complex_mul(u01, a1));
            state->data[i1] = complex_add(complex_mul(u10, a0), complex_mul(u11, a1));
        }
    }

    if (should_free) free(old);
    return 0;
}

static inline size_t swap_bits(size_t x, int i, int j)
{
    size_t bit_i = (x >> (unsigned)i) & 1U;
    size_t bit_j = (x >> (unsigned)j) & 1U;
    if (bit_i == bit_j) return x;
    size_t mask = ((size_t)1U << (unsigned)i) | ((size_t)1U << (unsigned)j);
    return x ^ mask;
}

int qs_apply_swap(QuantumState *state,
                  int q1,
                  int q2,
                  const int *controls,
                  size_t control_count,
                  Complex *scratch)
{
    if (!state || !state->data) return -1;
    if (!is_valid_qubit_index(state, q1) || !is_valid_qubit_index(state, q2)) return -1;
    if (control_count > 0 && !controls) return -1;

    if (q1 == q2) return 0;

    size_t control_mask = 0;
    if (build_control_mask(state, controls, control_count, q1, q2, &control_mask) != 0) return -1;

    size_t n = state->size;

    bool should_free = false;
    Complex *old = scratch;
    if (!old) {
        old = malloc(n * sizeof(Complex));
        if (!old) return -1;
        should_free = true;
    }
    memcpy(old, state->data, n * sizeof(Complex));

    for (size_t k = 0; k < n; k++) {
        if ((k & control_mask) != control_mask) continue;
        size_t k_swapped = swap_bits(k, q1, q2);
        if (k_swapped <= k) continue;

        state->data[k] = old[k_swapped];
        state->data[k_swapped] = old[k];
    }

    if (should_free) free(old);
    return 0;
}

double qs_norm2(const QuantumState *state)
{
    if (!state || !state->data) return 0.0;

    double acc = 0.0;
    for (size_t i = 0; i < state->size; i++) {
        double re = state->data[i].real;
        double im = state->data[i].imag;
        acc += re * re + im * im;
    }
    return acc;
}

