CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -O1

test: test_pdb test_pdb_fast
	./test_pdb
	./test_pdb_fast

test_pdb: test_pdb.c ../src/pdb.c ../src/pdb.h
	$(CC) $(CFLAGS) -o $@ test_pdb.c ../src/pdb.c

# The same scenarios against the short bench timers (make FAST=1 in the parent).
test_pdb_fast: test_pdb.c ../src/pdb.c ../src/pdb.h
	$(CC) $(CFLAGS) -DPDB_FAST -o $@ test_pdb.c ../src/pdb.c

clean:
	rm -f test_pdb test_pdb_fast

.PHONY: test clean
