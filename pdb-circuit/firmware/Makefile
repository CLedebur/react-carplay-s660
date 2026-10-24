# S660-PDB ATtiny85 firmware. Builds on the Pi (or any machine with gcc-avr + avr-libc),
# flashes from the Pi over the J3/J103 ISP lines (PDB reference §9.4).
#   make              build s660_pdb.hex
#   make FAST=1       bench build with short timers (30 s grace, 2 s HALT/battery/cycle)
#   make test         host unit tests (any C compiler)
#   make flash        write the flash   (JP1/JP101 bridge fitted!)
#   make fuses        write the fuses once per chip
#   make verify-fuses read the fuses back
#   make id           read the chip signature only (safe first contact check)

MCU        = attiny85
PROGRAMMER ?= pdb_isp
AVRDUDE    = avrdude -C +pdb_isp.conf -c $(PROGRAMMER) -p t85   # user must be in the gpio group

# lfuse 0xE2: internal 8 MHz RC, CKDIV8 off, slow start-up.
# hfuse 0xDD: BOD 2.7 V, SPIEN programmed (ISP stays on), RSTDISBL and DWEN unprogrammed.
# efuse 0xFF: self-programming off.
LFUSE = 0xE2
HFUSE = 0xDD
EFUSE = 0xFF

CC      = avr-gcc
OBJCOPY = avr-objcopy
CFLAGS  = -mmcu=$(MCU) -DF_CPU=8000000UL -std=gnu11 -Os -Wall -Wextra -ffunction-sections -fdata-sections
LDFLAGS = -mmcu=$(MCU) -Wl,--gc-sections
ifeq ($(FAST),1)
CFLAGS += -DPDB_FAST
endif

SRC = src/main.c src/pdb.c

s660_pdb.hex: s660_pdb.elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@
	avr-size --format=avr --mcu=$(MCU) $<

s660_pdb.elf: $(SRC) src/pdb.h FORCE
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRC)

# Rebuild every time so a FAST build is never flashed by mistake as the real one.
FORCE:

test:
	$(MAKE) -C tests test

flash: s660_pdb.hex
	$(AVRDUDE) -U flash:w:$<:i

# RSTDISBL (hfuse bit 7) must stay 1 and SPIEN (bit 5) must stay 0, or ISP is lost for good.
fuses:
	@test $$(( $(HFUSE) & 0x80 )) -ne 0 || { echo "refusing: HFUSE $(HFUSE) sets RSTDISBL"; exit 1; }
	@test $$(( $(HFUSE) & 0x20 )) -eq 0 || { echo "refusing: HFUSE $(HFUSE) clears SPIEN"; exit 1; }
	$(AVRDUDE) -U lfuse:w:$(LFUSE):m -U hfuse:w:$(HFUSE):m -U efuse:w:$(EFUSE):m

verify-fuses:
	$(AVRDUDE) -U lfuse:r:-:h -U hfuse:r:-:h -U efuse:r:-:h

id:
	$(AVRDUDE) -U signature:r:-:h

clean:
	rm -f s660_pdb.elf s660_pdb.hex
	$(MAKE) -C tests clean

.PHONY: test flash fuses verify-fuses id clean FORCE
