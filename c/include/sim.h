#ifndef SIM_H
#define SIM_H

#include <stddef.h>

#include "circuit.h"
#include "quantum.h"

typedef struct {
    QuantumState *states;
    size_t count;
} StateHistory;

typedef struct {
    int qubit;
    int value;
    double p0;
    double p1;
} MeasurementEvent;

typedef struct {
    MeasurementEvent *events;
    size_t count;
} MeasurementHistory;

int sim_run(const Circuit *circuit,
            QuantumState *state,
            Complex *scratch,
            StateHistory *history,
            MeasurementHistory *measurements);
void sim_history_free(StateHistory *history);
void sim_measurements_free(MeasurementHistory *measurements);

#endif
