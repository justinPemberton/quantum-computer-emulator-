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

typedef struct {
    int value;
} FxEvent;

typedef struct {
    FxEvent *events;
    size_t count;
} FxHistory;

int sim_run(const Circuit *circuit,
            QuantumState *state,
            Complex *scratch,
            StateHistory *history,
            MeasurementHistory *measurements,
            FxHistory *fx);
void sim_history_free(StateHistory *history);
void sim_measurements_free(MeasurementHistory *measurements);
void sim_fx_free(FxHistory *fx);

#endif
