#include "circuit.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    Circuit circuit;

    bool in_operations;
    int operations_indent;

    bool have_current_op;
    int current_op_indent;
    CircuitOp current_op;

    bool in_matrix;
    int matrix_indent;
    bool current_matrix_values_parsed;
} Parser;

static void op_reset(CircuitOp *op)
{
    memset(op, 0, sizeof(*op));
    op->kind = (GateKind)-1;
    op->fx.function = UF_PARITY;
    op->uf.function = UF_PARITY;
    op->uf.y_bit = -1;
}

static void op_free(CircuitOp *op)
{
    if (!op) return;
    free(op->targets);
    free(op->controls);
    free(op->fx.x_bits);
    free(op->uf.x_bits);
    op_reset(op);
}

static void parser_init(Parser *p)
{
    memset(p, 0, sizeof(*p));
    p->circuit.qubit_count = -1;
    p->operations_indent = -1;
    p->current_op_indent = -1;
    p->matrix_indent = -1;
    op_reset(&p->current_op);
}

static void parser_free(Parser *p)
{
    if (!p) return;
    for (size_t i = 0; i < p->circuit.op_count; i++) {
        op_free(&p->circuit.ops[i]);
    }
    free(p->circuit.ops);
    p->circuit.ops = NULL;
    p->circuit.op_count = 0;
    op_free(&p->current_op);
}

static char *dup_printf(const char *fmt, int line_no)
{
    char buf[256];
    snprintf(buf, sizeof(buf), fmt, line_no);
    return strdup(buf);
}

static char *dup_printf2(const char *fmt, int line_no, const char *detail)
{
    char buf[512];
    snprintf(buf, sizeof(buf), fmt, line_no, detail ? detail : "");
    return strdup(buf);
}

static int push_current_op(Parser *p, int line_no, char **out_error)
{
    if (!p->have_current_op) return 0;

    CircuitOp *op = &p->current_op;
    if (op->kind == (GateKind)-1) {
        if (out_error) *out_error = dup_printf("line %d: operation missing gate", line_no);
        return -1;
    }
    if (op->kind == GATE_SWAP && op->target_count != 2) {
        if (out_error) *out_error = dup_printf("line %d: SWAP requires exactly 2 targets", line_no);
        return -1;
    }
    if (op->kind == GATE_OTHER && !p->current_matrix_values_parsed) {
        if (out_error) *out_error = dup_printf("line %d: OTHER gate missing matrix values", line_no);
        return -1;
    }
    if (op->kind == GATE_FX && op->control_count != 0) {
        if (out_error) *out_error = dup_printf("line %d: FX does not support controls", line_no);
        return -1;
    }
    if (op->kind == GATE_UF) {
        if (op->uf.y_bit < 0 && op->target_count == 1) {
            op->uf.y_bit = op->targets[0];
        }
        if (op->uf.y_bit < 0) {
            if (out_error) *out_error = dup_printf("line %d: UF missing y_bit", line_no);
            return -1;
        }
    } else if (op->kind != GATE_SWAP && op->kind != GATE_FX && op->target_count == 0) {
        if (out_error) *out_error = dup_printf("line %d: operation missing targets", line_no);
        return -1;
    }

    size_t new_count = p->circuit.op_count + 1;
    CircuitOp *new_ops = realloc(p->circuit.ops, new_count * sizeof(CircuitOp));
    if (!new_ops) {
        if (out_error) *out_error = dup_printf("line %d: out of memory", line_no);
        return -1;
    }
    p->circuit.ops = new_ops;

    p->circuit.ops[p->circuit.op_count] = *op;
    p->circuit.op_count = new_count;

    op_reset(&p->current_op);
    p->have_current_op = false;
    p->current_op_indent = -1;
    p->in_matrix = false;
    p->matrix_indent = -1;
    p->current_matrix_values_parsed = false;
    return 0;
}

static int count_indent(const char *s)
{
    int n = 0;
    while (s && s[n] == ' ') n++;
    return n;
}

static char *trim_in_place(char *s)
{
    if (!s) return s;
    while (*s && isspace((unsigned char)*s)) s++;
    if (*s == '\0') return s;

    char *end = s + strlen(s) - 1;
    while (end > s && isspace((unsigned char)*end)) *end-- = '\0';
    return s;
}

static void strip_comment_in_place(char *s)
{
    if (!s) return;
    bool in_single = false;
    bool in_double = false;
    for (size_t i = 0; s[i] != '\0'; i++) {
        if (s[i] == '\'' && !in_double) in_single = !in_single;
        if (s[i] == '"' && !in_single) in_double = !in_double;
        if (!in_single && !in_double && s[i] == '#') {
            s[i] = '\0';
            return;
        }
    }
}

static bool split_key_value(char *s, char **out_key, char **out_val)
{
    if (!s) return false;
    char *colon = strchr(s, ':');
    if (!colon) return false;
    *colon = '\0';
    char *key = trim_in_place(s);
    char *val = trim_in_place(colon + 1);
    if (out_key) *out_key = key;
    if (out_val) *out_val = val;
    return true;
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

static int uf_function_from_name(const char *name, UfFunction *out_func)
{
    if (!name || !out_func) return -1;
    if (streq_ci(name, "parity") || streq_ci(name, "xor")) {
        *out_func = UF_PARITY;
        return 0;
    }
    if (streq_ci(name, "const0") || streq_ci(name, "zero") || streq_ci(name, "constant0")) {
        *out_func = UF_CONST0;
        return 0;
    }
    if (streq_ci(name, "const1") || streq_ci(name, "one") || streq_ci(name, "constant1")) {
        *out_func = UF_CONST1;
        return 0;
    }
    return -1;
}

static int parse_int_scalar(const char *s, int *out_value)
{
    if (!s || !out_value) return -1;
    errno = 0;
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (errno != 0) return -1;
    while (end && isspace((unsigned char)*end)) end++;
    if (!end || *end != '\0') return -1;
    if (v < 0 || v > INT_MAX) return -1;
    *out_value = (int)v;
    return 0;
}

static int parse_qubit_token(const char *tok, int *out_value)
{
    if (!tok || !out_value) return -1;
    while (*tok && isspace((unsigned char)*tok)) tok++;
    if (*tok == 'q' || *tok == 'Q') tok++;
    if (!isdigit((unsigned char)*tok)) return -1;
    errno = 0;
    char *end = NULL;
    long v = strtol(tok, &end, 10);
    if (errno != 0) return -1;
    while (end && isspace((unsigned char)*end)) end++;
    if (!end || *end != '\0') return -1;
    if (v < 0 || v > INT_MAX) return -1;
    *out_value = (int)v;
    return 0;
}

static int parse_qubit_list(const char *value, int **out_list, size_t *out_count)
{
    if (!out_list || !out_count) return -1;
    *out_list = NULL;
    *out_count = 0;
    if (!value) return 0;

    const char *p = value;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p == '\0') return 0;

    int *list = NULL;
    size_t count = 0;
    size_t cap = 0;

    if (*p != '[') {
        int q = 0;
        if (parse_qubit_token(p, &q) != 0) return -1;
        list = malloc(sizeof(int));
        if (!list) return -1;
        list[0] = q;
        *out_list = list;
        *out_count = 1;
        return 0;
    }

    p++;  // '['
    while (*p) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == ']') {
            p++;
            break;
        }

        const char *start = p;
        while (*p && *p != ',' && *p != ']') p++;
        size_t len = (size_t)(p - start);
        char *tok = malloc(len + 1);
        if (!tok) {
            free(list);
            return -1;
        }
        memcpy(tok, start, len);
        tok[len] = '\0';
        char *trimmed = trim_in_place(tok);
        int q = 0;
        int ok = parse_qubit_token(trimmed, &q);
        free(tok);
        if (ok != 0) {
            free(list);
            return -1;
        }

        if (count == cap) {
            size_t new_cap = cap == 0 ? 4 : cap * 2;
            int *new_list = realloc(list, new_cap * sizeof(int));
            if (!new_list) {
                free(list);
                return -1;
            }
            list = new_list;
            cap = new_cap;
        }
        list[count++] = q;

        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == ',') {
            p++;
            continue;
        }
        if (*p == ']') {
            p++;
            break;
        }
    }

    *out_list = list;
    *out_count = count;
    return 0;
}

static const char *skip_ws(const char *p)
{
    while (p && *p && isspace((unsigned char)*p)) p++;
    return p;
}

static int parse_number(const char **p, double *out_value)
{
    if (!p || !*p || !out_value) return -1;
    const char *s = skip_ws(*p);
    errno = 0;
    char *end = NULL;
    double v = strtod(s, &end);
    if (errno != 0) return -1;
    if (end == s) return -1;
    *out_value = v;
    *p = end;
    return 0;
}

static int parse_identifier(const char **p, char *out, size_t out_size)
{
    if (!p || !*p || !out || out_size == 0) return -1;
    const char *s = skip_ws(*p);
    size_t i = 0;
    if (!(isalpha((unsigned char)*s) || *s == '_')) return -1;
    while ((isalpha((unsigned char)*s) || isdigit((unsigned char)*s) || *s == '_' || *s == '-')) {
        if (i + 1 < out_size) out[i++] = *s;
        s++;
    }
    out[i] = '\0';
    *p = s;
    return 0;
}

static int parse_complex(const char **p, Complex *out_value)
{
    if (!p || !*p || !out_value) return -1;
    const char *s = skip_ws(*p);

    if (*s != '{') {
        double re = 0.0;
        if (parse_number(&s, &re) != 0) return -1;
        *out_value = (Complex){.real = re, .imag = 0.0};
        *p = s;
        return 0;
    }

    s++;  // '{'
    double re = 0.0;
    double im = 0.0;
    bool have_re = false;
    bool have_im = false;

    while (*s) {
        s = skip_ws(s);
        if (*s == '}') {
            s++;
            break;
        }

        char key[16];
        if (parse_identifier(&s, key, sizeof(key)) != 0) return -1;
        s = skip_ws(s);
        if (*s != ':') return -1;
        s++;

        double v = 0.0;
        if (parse_number(&s, &v) != 0) return -1;

        if (strcmp(key, "real") == 0) {
            re = v;
            have_re = true;
        } else if (strcmp(key, "imag") == 0) {
            im = v;
            have_im = true;
        } else {
            return -1;
        }

        s = skip_ws(s);
        if (*s == ',') {
            s++;
            continue;
        }
        if (*s == '}') {
            s++;
            break;
        }
    }

    if (!have_re || !have_im) return -1;
    *out_value = (Complex){.real = re, .imag = im};
    *p = s;
    return 0;
}

static int parse_matrix2_values(const char *value, Matrix2 *out_matrix)
{
    if (!value || !out_matrix) return -1;
    const char *p = skip_ws(value);
    if (*p != '[') return -1;
    p++;
    p = skip_ws(p);
    if (*p != '[') return -1;
    p++;
    if (parse_complex(&p, &out_matrix->values[0]) != 0) return -1;
    p = skip_ws(p);
    if (*p != ',') return -1;
    p++;
    if (parse_complex(&p, &out_matrix->values[1]) != 0) return -1;
    p = skip_ws(p);
    if (*p != ']') return -1;
    p++;
    p = skip_ws(p);
    if (*p != ',') return -1;
    p++;
    p = skip_ws(p);
    if (*p != '[') return -1;
    p++;
    if (parse_complex(&p, &out_matrix->values[2]) != 0) return -1;
    p = skip_ws(p);
    if (*p != ',') return -1;
    p++;
    if (parse_complex(&p, &out_matrix->values[3]) != 0) return -1;
    p = skip_ws(p);
    if (*p != ']') return -1;
    p++;
    p = skip_ws(p);
    if (*p != ']') return -1;
    return 0;
}

static int bracket_delta(const char *s)
{
    int d = 0;
    for (size_t i = 0; s && s[i] != '\0'; i++) {
        if (s[i] == '[') d++;
        if (s[i] == ']') d--;
    }
    return d;
}

static int collect_flow_value(FILE *f,
                              char **line,
                              size_t *line_cap,
                              int *line_no,
                              char *initial,
                              char **out_value)
{
    if (!f || !line || !line_cap || !line_no || !out_value) return -1;
    *out_value = NULL;

    char *acc = NULL;
    size_t acc_len = 0;
    int depth = 0;
    bool started = false;

    char *piece = trim_in_place(initial);
    if (piece && *piece) {
        started = strchr(piece, '[') != NULL;
        depth += bracket_delta(piece);
        acc_len = strlen(piece);
        acc = malloc(acc_len + 1);
        if (!acc) return -1;
        memcpy(acc, piece, acc_len + 1);
    } else {
        acc = strdup("");
        if (!acc) return -1;
    }

    while (!started || depth != 0) {
        ssize_t got = getline(line, line_cap, f);
        if (got < 0) {
            free(acc);
            return -1;
        }
        (*line_no)++;
        strip_comment_in_place(*line);
        char *t = trim_in_place(*line);
        if (!started) started = strchr(t, '[') != NULL;
        depth += bracket_delta(t);

        size_t tlen = strlen(t);
        if (tlen == 0) continue;

        size_t new_len = acc_len + 1 + tlen;
        char *new_acc = realloc(acc, new_len + 1);
        if (!new_acc) {
            free(acc);
            return -1;
        }
        acc = new_acc;
        acc[acc_len] = ' ';
        memcpy(acc + acc_len + 1, t, tlen + 1);
        acc_len = new_len;
    }

    *out_value = acc;
    return 0;
}

static int validate_indices(const Circuit *circuit, char **out_error)
{
    if (!circuit) return -1;
    if (circuit->qubit_count < 0) {
        if (out_error) *out_error = strdup("missing qubits");
        return -1;
    }

    for (size_t i = 0; i < circuit->op_count; i++) {
        const CircuitOp *op = &circuit->ops[i];
        for (size_t t = 0; t < op->target_count; t++) {
            int q = op->targets[t];
            if (q < 0 || q >= circuit->qubit_count) {
                if (out_error) *out_error = strdup("target qubit out of range");
                return -1;
            }
        }
        for (size_t c = 0; c < op->control_count; c++) {
            int q = op->controls[c];
            if (q < 0 || q >= circuit->qubit_count) {
                if (out_error) *out_error = strdup("control qubit out of range");
                return -1;
            }
        }

        if (op->kind == GATE_FX) {
            if (op->control_count != 0) {
                if (out_error) *out_error = strdup("FX does not support controls");
                return -1;
            }
            for (size_t xb = 0; xb < op->fx.x_bit_count; xb++) {
                int q = op->fx.x_bits[xb];
                if (q < 0 || q >= circuit->qubit_count) {
                    if (out_error) *out_error = strdup("FX x_bits out of range");
                    return -1;
                }
            }
        }

        if (op->kind == GATE_UF) {
            if (op->uf.y_bit < 0 || op->uf.y_bit >= circuit->qubit_count) {
                if (out_error) *out_error = strdup("UF y_bit out of range");
                return -1;
            }
            for (size_t xb = 0; xb < op->uf.x_bit_count; xb++) {
                int q = op->uf.x_bits[xb];
                if (q < 0 || q >= circuit->qubit_count) {
                    if (out_error) *out_error = strdup("UF x_bits out of range");
                    return -1;
                }
                if (q == op->uf.y_bit) {
                    if (out_error) *out_error = strdup("UF x_bits must not include y_bit");
                    return -1;
                }
            }
        }
    }
    return 0;
}

static int validate_fx_rules(const Circuit *circuit, char **out_error)
{
    if (!circuit) return -1;
    if (circuit->qubit_count < 0) return -1;

    bool *measured = calloc((size_t)circuit->qubit_count, sizeof(bool));
    if (!measured) {
        if (out_error) *out_error = strdup("out of memory");
        return -1;
    }

    bool fx_seen = false;

    for (size_t i = 0; i < circuit->op_count; i++) {
        const CircuitOp *op = &circuit->ops[i];

        if (fx_seen && op->kind != GATE_FX) {
            if (out_error) *out_error = strdup("quantum operation not allowed after FX");
            free(measured);
            return -1;
        }

        if (op->kind == GATE_MEASURE) {
            for (size_t t = 0; t < op->target_count; t++) {
                int q = op->targets[t];
                if (q >= 0 && q < circuit->qubit_count) measured[q] = true;
            }
            continue;
        }

        if (op->kind == GATE_FX) {
            for (size_t xb = 0; xb < op->fx.x_bit_count; xb++) {
                int q = op->fx.x_bits[xb];
                if (q < 0 || q >= circuit->qubit_count) continue;
                if (!measured[q]) {
                    if (out_error) *out_error = strdup("FX requires x_bits to be measured before use");
                    free(measured);
                    return -1;
                }
            }
            fx_seen = true;
            continue;
        }
    }

    free(measured);
    return 0;
}

int circuit_load_yaml_file(const char *path, Circuit *out_circuit, char **out_error)
{
    if (out_error) *out_error = NULL;
    if (!path || !out_circuit) return -1;

    FILE *f = fopen(path, "r");
    if (!f) {
        if (out_error) *out_error = strdup("failed to open file");
        return -1;
    }

    Parser parser;
    parser_init(&parser);

    char *line = NULL;
    size_t line_cap = 0;
    int line_no = 0;

    int rc = 0;
    while (true) {
        ssize_t got = getline(&line, &line_cap, f);
        if (got < 0) break;
        line_no++;

        strip_comment_in_place(line);
        int indent = count_indent(line);
        char *content = trim_in_place(line + indent);
        if (*content == '\0') continue;

        if (parser.in_operations && indent <= parser.operations_indent) {
            if (push_current_op(&parser, line_no, out_error) != 0) {
                rc = -1;
                break;
            }
            parser.in_operations = false;
            parser.operations_indent = -1;
        }

        if (strcmp(content, "operations:") == 0) {
            parser.in_operations = true;
            parser.operations_indent = indent;
            continue;
        }

        if (indent == 0) {
            char *kv = strdup(content);
            if (!kv) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: out of memory", line_no);
                break;
            }
            char *key = NULL;
            char *val = NULL;
            if (split_key_value(kv, &key, &val)) {
                if (strcmp(key, "qubits") == 0 || strcmp(key, "qubit_count") == 0) {
                    int q = 0;
                    if (parse_int_scalar(val, &q) != 0) {
                        rc = -1;
                        if (out_error) *out_error = dup_printf("line %d: invalid qubits value", line_no);
                        free(kv);
                        break;
                    }
                    parser.circuit.qubit_count = q;
                }
            }
            free(kv);
        }

        if (!parser.in_operations) continue;

        if (content[0] == '-' && isspace((unsigned char)content[1])) {
            if (push_current_op(&parser, line_no, out_error) != 0) {
                rc = -1;
                break;
            }

            parser.have_current_op = true;
            parser.current_op_indent = indent;
            op_reset(&parser.current_op);
            parser.in_matrix = false;
            parser.matrix_indent = -1;
            parser.current_matrix_values_parsed = false;

            char *rest = trim_in_place(content + 1);
            if (*rest != '\0') {
                char *kv = strdup(rest);
                if (!kv) {
                    rc = -1;
                    if (out_error) *out_error = dup_printf("line %d: out of memory", line_no);
                    break;
                }
                char *key = NULL;
                char *val = NULL;
                if (split_key_value(kv, &key, &val)) {
                    if (strcmp(key, "gate") == 0) {
                        GateKind kind;
                        if (gate_kind_from_name(val, &kind) != 0) {
                            rc = -1;
                            if (out_error) *out_error = dup_printf2("line %d: unknown gate '%s'", line_no, val);
                            free(kv);
                            break;
                        }
                        parser.current_op.kind = kind;
                    }
                }
                free(kv);
            }
            continue;
        }

        if (!parser.have_current_op) continue;
        if (indent <= parser.current_op_indent) continue;

        char *kv = strdup(content);
        if (!kv) {
            rc = -1;
            if (out_error) *out_error = dup_printf("line %d: out of memory", line_no);
            break;
        }
        char *key = NULL;
        char *val = NULL;
        if (!split_key_value(kv, &key, &val)) {
            free(kv);
            continue;
        }

        if (strcmp(key, "gate") == 0) {
            GateKind kind;
            if (gate_kind_from_name(val, &kind) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf2("line %d: unknown gate '%s'", line_no, val);
                free(kv);
                break;
            }
            parser.current_op.kind = kind;
            if (kind == GATE_FX && parser.current_op.fx.x_bit_count == 0 && parser.current_op.uf.x_bit_count > 0) {
                parser.current_op.fx.x_bits = parser.current_op.uf.x_bits;
                parser.current_op.fx.x_bit_count = parser.current_op.uf.x_bit_count;
                parser.current_op.uf.x_bits = NULL;
                parser.current_op.uf.x_bit_count = 0;
            }
        } else if (strcmp(key, "targets") == 0) {
            free(parser.current_op.targets);
            parser.current_op.targets = NULL;
            parser.current_op.target_count = 0;
            if (parse_qubit_list(val, &parser.current_op.targets, &parser.current_op.target_count) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: invalid targets list", line_no);
                free(kv);
                break;
            }
        } else if (strcmp(key, "controls") == 0) {
            free(parser.current_op.controls);
            parser.current_op.controls = NULL;
            parser.current_op.control_count = 0;
            if (parse_qubit_list(val, &parser.current_op.controls, &parser.current_op.control_count) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: invalid controls list", line_no);
                free(kv);
                break;
            }
        } else if (strcmp(key, "function") == 0) {
            UfFunction func;
            if (uf_function_from_name(val, &func) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf2("line %d: unknown UF function '%s'", line_no, val);
                free(kv);
                break;
            }
            parser.current_op.fx.function = func;
            parser.current_op.uf.function = func;
        } else if (strcmp(key, "x_bits") == 0) {
            int **list = parser.current_op.kind == GATE_FX ? &parser.current_op.fx.x_bits : &parser.current_op.uf.x_bits;
            size_t *count =
                parser.current_op.kind == GATE_FX ? &parser.current_op.fx.x_bit_count : &parser.current_op.uf.x_bit_count;
            free(*list);
            *list = NULL;
            *count = 0;
            if (parse_qubit_list(val, list, count) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: invalid x_bits list", line_no);
                free(kv);
                break;
            }
        } else if (strcmp(key, "y_bit") == 0) {
            int y = 0;
            if (parse_qubit_token(val, &y) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: invalid y_bit", line_no);
                free(kv);
                break;
            }
            parser.current_op.uf.y_bit = y;
        } else if (strcmp(key, "matrix") == 0) {
            parser.in_matrix = true;
            parser.matrix_indent = indent;
        } else if (parser.in_matrix && strcmp(key, "values") == 0) {
            char *flow = NULL;
            if (collect_flow_value(f, &line, &line_cap, &line_no, val, &flow) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: invalid matrix values", line_no);
                free(kv);
                break;
            }
            if (parse_matrix2_values(flow, &parser.current_op.other_matrix) != 0) {
                rc = -1;
                if (out_error) *out_error = dup_printf("line %d: failed to parse 2x2 matrix values", line_no);
                free(flow);
                free(kv);
                break;
            }
            parser.current_matrix_values_parsed = true;
            free(flow);
        }

        free(kv);
    }

    if (rc == 0) {
        if (push_current_op(&parser, line_no + 1, out_error) != 0) {
            rc = -1;
        }
    }

    free(line);
    fclose(f);

    if (rc == 0 && validate_indices(&parser.circuit, out_error) != 0) {
        rc = -1;
    }

    if (rc == 0 && validate_fx_rules(&parser.circuit, out_error) != 0) {
        rc = -1;
    }

    if (rc != 0) {
        parser_free(&parser);
        return -1;
    }

    *out_circuit = parser.circuit;
    return 0;
}

void circuit_free(Circuit *circuit)
{
    if (!circuit) return;
    for (size_t i = 0; i < circuit->op_count; i++) {
        op_free(&circuit->ops[i]);
    }
    free(circuit->ops);
    circuit->ops = NULL;
    circuit->op_count = 0;
    circuit->qubit_count = 0;
}

size_t circuit_step_count(const Circuit *circuit)
{
    if (!circuit) return 0;
    size_t steps = 0;
    for (size_t i = 0; i < circuit->op_count; i++) {
        const CircuitOp *op = &circuit->ops[i];
        if (op->kind == GATE_SWAP || op->kind == GATE_UF) {
            steps += 1;
        } else {
            steps += op->target_count;
        }
    }
    return steps;
}
