// S660-PDB power supervisor — the ATtiny85 (U1 / U101) state machine.
// Pure C, no AVR headers, so it can be unit-tested on the host (see ../tests).
// Spec: references/S660-PDB_Design_Reference.md §4.3, timings §10.3.
//
//   SLEEP  relay open, MCU in power-down; wakes on an ignition pin change
//   RUN    ignition on: relay closed
//   GRACE  ignition just went off: relay stays closed while the Pi shuts down
//   CUT    relay open, LED on for a moment, then SLEEP
//   CYCLE  the Pi halted with the ignition still on: relay open 5 s, then back to RUN
//          (an addition to §4.3, agreed 2026-10-24: a halted Pi restarts without a key cycle)
//
// GRACE ends in CUT on whichever comes first: the 5:15 backstop, HALT high for 10 s,
// or the battery below 11.0 V for 10 s. The ignition coming back sends GRACE to RUN.
#pragma once
#include <stdint.h>
#include <stdbool.h>

#define PDB_TICK_MS 10

#ifdef PDB_FAST   // bench build: short timers so every path can be watched in a minute
#define PDB_GRACE_MS   30000UL
#define PDB_HALT_MS     2000U
#define PDB_LOWBATT_MS  2000U
#define PDB_CYCLE_MS    2000U
#else
#define PDB_GRACE_MS  315000UL   // 5 min 15 s backstop (Pi's own countdown is 4:30)
#define PDB_HALT_MS    10000U    // HALT high this long = the Pi has halted
#define PDB_LOWBATT_MS 10000U    // battery low this long = cut
#define PDB_CYCLE_MS    5000U    // relay-open time when the Pi halts in RUN
#endif
#define PDB_IGN_DEBOUNCE_MS 200U // shorter ignition changes are ignored (cranking glitches)
#define PDB_CUT_LED_MS     1000U

// BATT_SENSE = 12V_IN × 15k / (68k + 15k), read against VCC (3.3 V) on a 10-bit ADC.
#define PDB_VREF_MV     3300UL
#define PDB_LOWBATT_MV 11000UL
#define PDB_LOWBATT_ADC ((uint16_t)(PDB_LOWBATT_MV * 15UL * 1024UL / (83UL * PDB_VREF_MV)))   // 616

typedef enum { PDB_SLEEP = 0, PDB_RUN, PDB_GRACE, PDB_CUT, PDB_CYCLE } pdb_state_t;

typedef struct {
    bool ign_on;        // raw: ACC or ON present (IGN_STATE low)
    bool halt;          // raw: HALT_IN high
    uint16_t batt_adc;  // raw ADC3 reading
} pdb_inputs_t;

typedef struct {
    pdb_state_t state;
    bool ign_on;        // debounced
    uint16_t ign_ms;    // how long the raw input has disagreed with ign_on
    uint32_t state_ms;  // time in the current state
    uint16_t halt_ms;   // how long HALT has been high
    uint16_t low_ms;    // how long the battery has been low
    uint16_t led_ms;    // free-running, for the blink patterns
} pdb_t;

void pdb_init(pdb_t *p, bool ign_on);
void pdb_tick(pdb_t *p, const pdb_inputs_t *in, uint16_t dt_ms);
bool pdb_relay(const pdb_t *p);
bool pdb_led(const pdb_t *p);
// True when nothing is pending and the MCU may enter power-down (only an ignition
// pin change can wake it, so the caller must also check the raw ignition is off).
bool pdb_can_power_down(const pdb_t *p);
