#include "sim.h"

#include <stdlib.h>
#include <string.h>

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

int sim_run(const Circuit *circuit, QuantumState *state, Complex *scratch, StateHistory *history)
{
    if (!circuit || !state) return -1;

    if (history) {
        history->states = NULL;
        history->count = 0;
        size_t steps = circuit_step_count(circuit);
        if (history_reserve(history, steps + 1) != 0) return -1;
        if (history_push(history, state) != 0) return -1;
    }

    for (size_t op_index = 0; op_index < circuit->op_count; op_index++) {
        const CircuitOp *op = &circuit->ops[op_index];

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

