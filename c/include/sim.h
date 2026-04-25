#ifndef SIM_H
#define SIM_H

#include <stddef.h>

#include "circuit.h"
#include "quantum.h"

typedef struct {
    QuantumState *states;
    size_t count;
} StateHistory;

int sim_run(const Circuit *circuit, QuantumState *state, Complex *scratch, StateHistory *history);
void sim_history_free(StateHistory *history);

#endif

