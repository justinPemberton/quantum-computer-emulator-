#include "gates.h"

#include <ctype.h>
#include <stdbool.h>
#include <string.h>

static const double INV_SQRT2 = 0.7071067811865475244;

static const Matrix2 H_MATRIX = {.values = {
    {+INV_SQRT2, 0.0},
    {+INV_SQRT2, 0.0},
    {+INV_SQRT2, 0.0},
    {-INV_SQRT2, 0.0},
}};

static const Matrix2 X_MATRIX = {.values = {
    {0.0, 0.0},
    {1.0, 0.0},
    {1.0, 0.0},
    {0.0, 0.0},
}};

static const Matrix2 Y_MATRIX = {.values = {
    {0.0, 0.0},
    {0.0, -1.0},
    {0.0, +1.0},
    {0.0, 0.0},
}};

static const Matrix2 Z_MATRIX = {.values = {
    {+1.0, 0.0},
    {0.0, 0.0},
    {0.0, 0.0},
    {-1.0, 0.0},
}};

static const Matrix2 S_MATRIX = {.values = {
    {+1.0, 0.0},
    {0.0, 0.0},
    {0.0, 0.0},
    {0.0, +1.0},
}};

static const Matrix2 T_MATRIX = {.values = {
    {+1.0, 0.0},
    {0.0, 0.0},
    {0.0, 0.0},
    {+INV_SQRT2, +INV_SQRT2},
}};

const Matrix2 *gate_standard_matrix(GateKind kind)
{
    switch (kind) {
        case GATE_H:
            return &H_MATRIX;
        case GATE_X:
            return &X_MATRIX;
        case GATE_Y:
            return &Y_MATRIX;
        case GATE_Z:
            return &Z_MATRIX;
        case GATE_S:
            return &S_MATRIX;
        case GATE_T:
            return &T_MATRIX;
        case GATE_MEASURE:
        case GATE_FX:
        case GATE_UF:
        case GATE_OTHER:
        case GATE_SWAP:
        default:
            return NULL;
    }
}

const char *gate_kind_name(GateKind kind)
{
    switch (kind) {
        case GATE_H:
            return "H";
        case GATE_X:
            return "X";
        case GATE_Y:
            return "Y";
        case GATE_Z:
            return "Z";
        case GATE_S:
            return "S";
        case GATE_T:
            return "T";
        case GATE_MEASURE:
            return "MEASURE";
        case GATE_FX:
            return "FX";
        case GATE_UF:
            return "UF";
        case GATE_OTHER:
            return "OTHER";
        case GATE_SWAP:
            return "SWAP";
        default:
            return "UNKNOWN";
    }
}

static bool streq_ci(const char *a, const char *b)
{
    if (!a || !b) return false;
    while (*a && *b) {
        unsigned char ca = (unsigned char)*a++;
        unsigned char cb = (unsigned char)*b++;
        if (tolower(ca) != tolower(cb)) return false;
    }
    return *a == '\0' && *b == '\0';
}

int gate_kind_from_name(const char *name, GateKind *out_kind)
{
    if (!name || !out_kind) return -1;

    if (streq_ci(name, "H")) {
        *out_kind = GATE_H;
        return 0;
    }
    if (streq_ci(name, "X")) {
        *out_kind = GATE_X;
        return 0;
    }
    if (streq_ci(name, "Y")) {
        *out_kind = GATE_Y;
        return 0;
    }
    if (streq_ci(name, "Z")) {
        *out_kind = GATE_Z;
        return 0;
    }
    if (streq_ci(name, "S")) {
        *out_kind = GATE_S;
        return 0;
    }
    if (streq_ci(name, "T")) {
        *out_kind = GATE_T;
        return 0;
    }
    if (streq_ci(name, "MEASURE") || streq_ci(name, "MEAS") || streq_ci(name, "M")) {
        *out_kind = GATE_MEASURE;
        return 0;
    }
    if (streq_ci(name, "FX") || streq_ci(name, "F(X)") || streq_ci(name, "F")) {
        *out_kind = GATE_FX;
        return 0;
    }
    if (streq_ci(name, "UF") || streq_ci(name, "ORACLE")) {
        *out_kind = GATE_UF;
        return 0;
    }
    if (streq_ci(name, "SWAP")) {
        *out_kind = GATE_SWAP;
        return 0;
    }
    if (streq_ci(name, "OTHER")) {
        *out_kind = GATE_OTHER;
        return 0;
    }

    return -1;
}
