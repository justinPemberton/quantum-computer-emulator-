#include "sim.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int history_reserve(StateHistory *h, size_t cap)
{
    if (!h) return 0;
    if (cap <= h->count) return 0;

    QuantumState *new_states = realloc(h->states, cap * sizeof(QuantumState));
    if (!new_states) return -1;
    h->states = new_states;
    return 0;
}

static int history_push(StateHistory *h, const QuantumState *state)
{
    if (!h) return 0;
    if (!state) return -1;

    size_t new_count = h->count + 1;
    QuantumState *new_states = realloc(h->states, new_count * sizeof(QuantumState));
    if (!new_states) return -1;
    h->states = new_states;

    QuantumState snap;
    if (qs_init(&snap, state->qubit_count) != 0) return -1;
    memcpy(snap.data, state->data, state->size * sizeof(Complex));
    h->states[h->count] = snap;
    h->count = new_count;
    return 0;
}

static int measurements_push(MeasurementHistory *h, MeasurementEvent event)
{
    if (!h) return 0;

    size_t new_count = h->count + 1;
    MeasurementEvent *new_events = realloc(h->events, new_count * sizeof(MeasurementEvent));
    if (!new_events) return -1;
    h->events = new_events;
    h->events[h->count] = event;
    h->count = new_count;
    return 0;
}

static uint64_t seed_from_env(void)
{
    const char *s = getenv("QSIM_SEED");
    if (!s || *s == '\0') {
        uint64_t seed = 0;
        int fd = open("/dev/urandom", O_RDONLY);
        if (fd >= 0) {
            ssize_t n = read(fd, &seed, sizeof(seed));
            close(fd);
            if (n == (ssize_t)sizeof(seed) && seed != 0) return seed;
        }

        struct timespec ts;
        if (clock_gettime(CLOCK_REALTIME, &ts) == 0) {
            seed ^= (uint64_t)ts.tv_sec;
            seed ^= (uint64_t)ts.tv_nsec << 32;
        }
        seed ^= (uint64_t)(unsigned)getpid() << 16;
        seed ^= (uint64_t)(uintptr_t)&seed;
        if (seed == 0) seed = UINT64_C(1);
        return seed;
    }

    errno = 0;
    char *end = NULL;
    unsigned long long v = strtoull(s, &end, 0);
    if (errno != 0 || end == s) return UINT64_C(1);
    if (v == 0) return UINT64_C(1);
    return (uint64_t)v;
}

int sim_run(const Circuit *circuit,
            QuantumState *state,
            Complex *scratch,
            StateHistory *history,
            MeasurementHistory *measurements)
{
    if (!circuit || !state) return -1;

    if (measurements) {
        measurements->events = NULL;
        measurements->count = 0;
    }

    if (history) {
        history->states = NULL;
        history->count = 0;
        size_t steps = circuit_step_count(circuit);
        if (history_reserve(history, steps + 1) != 0) return -1;
        if (history_push(history, state) != 0) return -1;
    }

    uint64_t rng_state = seed_from_env();

    for (size_t op_index = 0; op_index < circuit->op_count; op_index++) {
        const CircuitOp *op = &circuit->ops[op_index];

        if (op->kind == GATE_UF) {
            if (qs_apply_uf(state,
                            op->uf.function,
                            op->uf.x_bits,
                            op->uf.x_bit_count,
                            op->uf.y_bit,
                            op->controls,
                            op->control_count,
                            scratch) != 0) {
                return -1;
            }
            if (history && history_push(history, state) != 0) return -1;
            continue;
        }

        if (op->kind == GATE_SWAP) {
            if (qs_apply_swap(state,
                              op->targets[0],
                              op->targets[1],
                              op->controls,
                              op->control_count,
                              scratch) != 0) {
                return -1;
            }
            if (history && history_push(history, state) != 0) return -1;
            continue;
        }

        if (op->kind == GATE_MEASURE) {
            if (op->control_count != 0) return -1;

            for (size_t t = 0; t < op->target_count; t++) {
                int qubit = op->targets[t];
                int value = 0;
                double p0 = 0.0;
                double p1 = 0.0;
                if (qs_measure(state, qubit, &rng_state, &value, &p0, &p1) != 0) return -1;
                if (measurements_push(measurements, (MeasurementEvent){
                                                        .qubit = qubit,
                                                        .value = value,
                                                        .p0 = p0,
                                                        .p1 = p1,
                                                    }) != 0) {
                    return -1;
                }
                if (history && history_push(history, state) != 0) return -1;
            }
            continue;
        }

        const Matrix2 *m = NULL;
        if (op->kind == GATE_OTHER) {
            m = &op->other_matrix;
        } else {
            m = gate_standard_matrix(op->kind);
            if (!m) return -1;
        }

        for (size_t t = 0; t < op->target_count; t++) {
            int target = op->targets[t];
            int rc = 0;
            if (op->control_count == 0) {
                rc = qs_apply_single_qubit_gate(state, m, target, scratch);
            } else {
                rc = qs_apply_controlled_gate(state, m, target, op->controls, op->control_count, scratch);
            }
            if (rc != 0) return -1;
            if (history && history_push(history, state) != 0) return -1;
        }
    }

    return 0;
}

void sim_history_free(StateHistory *history)
{
    if (!history) return;
    for (size_t i = 0; i < history->count; i++) {
        qs_free(&history->states[i]);
    }
    free(history->states);
    history->states = NULL;
    history->count = 0;
}

void sim_measurements_free(MeasurementHistory *measurements)
{
    if (!measurements) return;
    free(measurements->events);
    measurements->events = NULL;
    measurements->count = 0;
}
