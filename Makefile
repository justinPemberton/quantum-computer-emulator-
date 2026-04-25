MAKE ?= make

.PHONY: all test clean

all:
	$(MAKE) -C c all

test:
	$(MAKE) -C c test

clean:
	$(MAKE) -C c clean

