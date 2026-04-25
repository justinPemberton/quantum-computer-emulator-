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

int qs_apply_uf(QuantumState *state,
                UfFunction function,
                const int *x_bits,
                size_t x_bit_count,
                int y_bit,
                const int *controls,
                size_t control_count,
                Complex *scratch)
{
    if (!state || !state->data) return -1;
    if (!is_valid_qubit_index(state, y_bit)) return -1;
    if (x_bit_count > 0 && !x_bits) return -1;
    if (control_count > 0 && !controls) return -1;

    size_t x_mask = 0;
    for (size_t i = 0; i < x_bit_count; i++) {
        int q = x_bits[i];
        if (!is_valid_qubit_index(state, q)) return -1;
        if (q == y_bit) return -1;
        x_mask |= (size_t)1U << (unsigned)q;
    }

    size_t control_mask = 0;
    if (build_control_mask(state, controls, control_count, y_bit, -1, &control_mask) != 0) return -1;

    size_t n = state->size;

    bool should_free = false;
    Complex *old = scratch;
    if (!old) {
        old = malloc(n * sizeof(Complex));
        if (!old) return -1;
        should_free = true;
    }
    memcpy(old, state->data, n * sizeof(Complex));

    size_t y_mask = (size_t)1ULL << (unsigned)y_bit;

    for (size_t i = 0; i < n; i++) {
        if ((i & y_mask) != 0) continue;
        if ((i & control_mask) != control_mask) continue;

        int fx = 0;
        switch (function) {
            case UF_PARITY:
                fx = (__builtin_popcountll((unsigned long long)(i & x_mask)) & 1U) != 0;
                break;
            case UF_CONST0:
                fx = 0;
                break;
            case UF_CONST1:
                fx = 1;
                break;
            default:
                if (should_free) free(old);
                return -1;
        }

        if (!fx) continue;

        size_t j = i | y_mask;
        state->data[i] = old[j];
        state->data[j] = old[i];
    }

    if (should_free) free(old);
    return 0;
}

static inline uint64_t rng_next_u64(uint64_t *state)
{
    uint64_t x = *state;
    if (x == 0) x = UINT64_C(0x9e3779b97f4a7c15);
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *state = x;
    return x * UINT64_C(0x2545F4914F6CDD1D);
}

static inline double rng_uniform_01(uint64_t *state)
{
    uint64_t x = rng_next_u64(state);
    return (double)(x >> 11) * (1.0 / 9007199254740992.0);  // 2^53
}

int qs_measure(QuantumState *state,
               int qubit,
               uint64_t *rng_state,
               int *out_value,
               double *out_p0,
               double *out_p1)
{
    if (!state || !state->data) return -1;
    if (!is_valid_qubit_index(state, qubit)) return -1;

    size_t mask = (size_t)1ULL << (unsigned)qubit;

    double p0 = 0.0;
    double p1 = 0.0;
    for (size_t i = 0; i < state->size; i++) {
        double re = state->data[i].real;
        double im = state->data[i].imag;
        double amp2 = re * re + im * im;
        if ((i & mask) != 0) {
            p1 += amp2;
        } else {
            p0 += amp2;
        }
    }

    double norm = p0 + p1;
    if (norm <= 0.0) return -1;

    double p0n = p0 / norm;
    double p1n = p1 / norm;

    if (out_p0) *out_p0 = p0n;
    if (out_p1) *out_p1 = p1n;

    int value = 0;
    if (p0 <= 0.0) {
        value = 1;
    } else if (p1 <= 0.0) {
        value = 0;
    } else if (!rng_state) {
        value = (p1 > p0) ? 1 : 0;
    } else {
        double r = rng_uniform_01(rng_state);
        value = (r < p0n) ? 0 : 1;
    }

    if (out_value) *out_value = value;

    double keep = value ? p1 : p0;
    if (keep <= 0.0) return -1;
    double inv = 1.0 / sqrt(keep);

    for (size_t i = 0; i < state->size; i++) {
        int bit = ((i & mask) != 0);
        if (bit != value) {
            state->data[i].real = 0.0;
            state->data[i].imag = 0.0;
        } else {
            state->data[i].real *= inv;
            state->data[i].imag *= inv;
        }
    }

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
