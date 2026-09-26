CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -O1

test: test_opera
	./test_opera

test_opera: test_opera.c ../src/opera.c ../src/opera.h
	$(CC) $(CFLAGS) -o $@ test_opera.c ../src/opera.c

clean:
	rm -f test_opera

.PHONY: test clean
