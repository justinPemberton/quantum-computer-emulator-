#include "circuit.h"
#include "gates.h"
#include "quantum.h"
#include "sim.h"

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const double INV_SQRT2 = 0.7071067811865475244;

static void expect_complex_close(Complex v, double re, double im)
{
    const double eps = 1e-12;
    assert(fabs(v.real - re) < eps);
    assert(fabs(v.imag - im) < eps);
}

int main(void)
{
    {
        QuantumState s;
        assert(qs_init(&s, 1) == 0);
        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        assert(qs_apply_single_qubit_gate(&s, gate_standard_matrix(GATE_H), 0, scratch) == 0);
        expect_complex_close(s.data[0], INV_SQRT2, 0.0);
        expect_complex_close(s.data[1], INV_SQRT2, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        free(scratch);
        qs_free(&s);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 1) == 0);
        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        assert(qs_apply_single_qubit_gate(&s, gate_standard_matrix(GATE_X), 0, scratch) == 0);
        expect_complex_close(s.data[0], 0.0, 0.0);
        expect_complex_close(s.data[1], 1.0, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        free(scratch);
        qs_free(&s);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 2) == 0);
        memset(s.data, 0, s.size * sizeof(Complex));
        s.data[2].real = 1.0;  // |10>

        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        int controls[] = {1};
        assert(qs_apply_controlled_gate(&s, gate_standard_matrix(GATE_X), 0, controls, 1, scratch) == 0);
        expect_complex_close(s.data[3], 1.0, 0.0);  // |11>
        expect_complex_close(s.data[2], 0.0, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        free(scratch);
        qs_free(&s);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 2) == 0);
        memset(s.data, 0, s.size * sizeof(Complex));
        s.data[1].real = 1.0;  // |01>

        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        assert(qs_apply_swap(&s, 0, 1, NULL, 0, scratch) == 0);
        expect_complex_close(s.data[2], 1.0, 0.0);  // |10>
        expect_complex_close(s.data[1], 0.0, 0.0);

        free(scratch);
        qs_free(&s);
    }

    {
        const char *yaml =
            "qubits: 2\n"
            "vectors:\n"
            "  - id: v0\n"
            "    operations:\n"
            "      - gate: H\n"
            "        targets: [q0]\n"
            "  - id: v1\n"
            "    operations:\n"
            "      - gate: X\n"
            "        controls: [q0]\n"
            "        targets: [q1]\n";

        char path[] = "/tmp/qsim-test-XXXXXX";
        int fd = mkstemp(path);
        assert(fd >= 0);
        FILE *f = fdopen(fd, "w");
        assert(f);
        fputs(yaml, f);
        fclose(f);

        Circuit c;
        char *err = NULL;
        assert(circuit_load_yaml_file(path, &c, &err) == 0);
        free(err);

        QuantumState s;
        assert(qs_init(&s, c.qubit_count) == 0);
        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        assert(sim_run(&c, &s, scratch, NULL, NULL) == 0);
        expect_complex_close(s.data[0], INV_SQRT2, 0.0);
        expect_complex_close(s.data[3], INV_SQRT2, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        free(scratch);
        qs_free(&s);
        circuit_free(&c);
        remove(path);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 1) == 0);
        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);
        assert(qs_apply_single_qubit_gate(&s, gate_standard_matrix(GATE_H), 1, scratch) != 0);

        int controls[] = {0};
        assert(qs_apply_controlled_gate(&s, gate_standard_matrix(GATE_X), 0, controls, 1, scratch) != 0);

        free(scratch);
        qs_free(&s);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 2) == 0);
        memset(s.data, 0, s.size * sizeof(Complex));
        s.data[1].real = 1.0;  // |01>

        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        int x_bits[] = {0};
        assert(qs_apply_uf(&s, UF_PARITY, x_bits, 1, 1, NULL, 0, scratch) == 0);
        expect_complex_close(s.data[3], 1.0, 0.0);  // |11>
        expect_complex_close(s.data[1], 0.0, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        assert(qs_apply_uf(&s, UF_PARITY, x_bits, 1, 1, NULL, 0, scratch) == 0);
        expect_complex_close(s.data[1], 1.0, 0.0);  // back to |01>
        expect_complex_close(s.data[3], 0.0, 0.0);

        free(scratch);
        qs_free(&s);
    }

    {
        QuantumState s;
        assert(qs_init(&s, 1) == 0);

        uint64_t rng = 123;
        int value = -1;
        double p0 = 0.0;
        double p1 = 0.0;
        assert(qs_measure(&s, 0, &rng, &value, &p0, &p1) == 0);
        assert(value == 0);
        assert(fabs(p0 - 1.0) < 1e-12);
        assert(fabs(p1 - 0.0) < 1e-12);
        expect_complex_close(s.data[0], 1.0, 0.0);
        expect_complex_close(s.data[1], 0.0, 0.0);
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        assert(qs_measure(&s, 0, &rng, &value, &p0, &p1) == 0);
        assert(value == 0);
        expect_complex_close(s.data[0], 1.0, 0.0);
        expect_complex_close(s.data[1], 0.0, 0.0);

        qs_free(&s);
    }

    {
        const char *yaml =
            "qubits: 2\n"
            "vectors:\n"
            "  - id: v0\n"
            "    operations:\n"
            "      - gate: X\n"
            "        targets: [q0]\n"
            "  - id: v1\n"
            "    operations:\n"
            "      - gate: UF\n"
            "        function: parity\n"
            "        x_bits: [q0]\n"
            "        y_bit: q1\n"
            "  - id: v2\n"
            "    operations:\n"
            "      - gate: MEASURE\n"
            "        targets: [q1]\n";

        char path[] = "/tmp/qsim-test-XXXXXX";
        int fd = mkstemp(path);
        assert(fd >= 0);
        FILE *f = fdopen(fd, "w");
        assert(f);
        fputs(yaml, f);
        fclose(f);

        Circuit c;
        char *err = NULL;
        assert(circuit_load_yaml_file(path, &c, &err) == 0);
        free(err);

        QuantumState s;
        assert(qs_init(&s, c.qubit_count) == 0);
        Complex *scratch = malloc(s.size * sizeof(Complex));
        assert(scratch);

        MeasurementHistory m;
        assert(sim_run(&c, &s, scratch, NULL, &m) == 0);
        assert(m.count == 1);
        assert(m.events[0].qubit == 1);
        assert(m.events[0].value == 1);
        assert(fabs(m.events[0].p0 - 0.0) < 1e-12);
        assert(fabs(m.events[0].p1 - 1.0) < 1e-12);
        sim_measurements_free(&m);

        expect_complex_close(s.data[3], 1.0, 0.0);  // |11>
        assert(fabs(qs_norm2(&s) - 1.0) < 1e-12);

        free(scratch);
        qs_free(&s);
        circuit_free(&c);
        remove(path);
    }

    return 0;
}
