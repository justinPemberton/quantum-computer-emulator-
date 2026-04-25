CC ?= cc

CFLAGS ?= -std=c11 -O3 -Wall -Wextra -Wpedantic
CPPFLAGS ?= -Iinclude
CPPFLAGS += -D_POSIX_C_SOURCE=200809L
LDFLAGS ?=
LDLIBS ?= -lm

BUILD_DIR := build
BIN_DIR := $(BUILD_DIR)/bin

LIB_OBJS := \
	$(BUILD_DIR)/quantum.o \
	$(BUILD_DIR)/gates.o \
	$(BUILD_DIR)/circuit.o \
	$(BUILD_DIR)/sim.o

CLI_OBJS := \
	$(BUILD_DIR)/main.o

TEST_OBJS := \
	$(BUILD_DIR)/test_quantum.o

.PHONY: all clean test

all: $(BIN_DIR)/qsim

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

$(BUILD_DIR)/%.o: src/%.c | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/test_%.o: tests/test_%.c | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BIN_DIR)/qsim: $(LIB_OBJS) $(CLI_OBJS) | $(BIN_DIR)
	$(CC) $(CFLAGS) $(LDFLAGS) $^ $(LDLIBS) -o $@

$(BUILD_DIR)/test_quantum: $(LIB_OBJS) $(TEST_OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) $^ $(LDLIBS) -o $@

test: $(BUILD_DIR)/test_quantum
	$(BUILD_DIR)/test_quantum

clean:
	rm -rf $(BUILD_DIR)
