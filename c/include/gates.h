#ifndef GATES_H
#define GATES_H

#include "quantum.h"

typedef enum {
    GATE_H = 0,
    GATE_X,
    GATE_Y,
    GATE_Z,
    GATE_S,
    GATE_T,
    GATE_MEASURE,
    GATE_UF,
    GATE_OTHER,
    GATE_SWAP,
} GateKind;

const Matrix2 *gate_standard_matrix(GateKind kind);
const char *gate_kind_name(GateKind kind);
int gate_kind_from_name(const char *name, GateKind *out_kind);

#endif
