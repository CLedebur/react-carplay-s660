// S660-PDB power supervisor state machine. See pdb.h.
#include "pdb.h"

static uint16_t add_sat(uint16_t a, uint16_t b) { return (uint16_t)(a > 0xFFFFu - b ? 0xFFFFu : a + b); }

static void enter(pdb_t *p, pdb_state_t s) {
    p->state = s;
    p->state_ms = 0;
    p->halt_ms = 0;   // every state judges HALT and the battery from its own start:
    p->low_ms = 0;    // a cranking dip in RUN must not count towards a GRACE cut
}

void pdb_init(pdb_t *p, bool ign_on) {
    p->ign_on = ign_on;
    p->ign_ms = 0;
    p->led_ms = 0;
    enter(p, ign_on ? PDB_RUN : PDB_SLEEP);
}

void pdb_tick(pdb_t *p, const pdb_inputs_t *in, uint16_t dt_ms) {
    p->led_ms = (uint16_t)((p->led_ms + dt_ms) % 2000u);
    if (p->state_ms < 0xFFFFFFFFUL - dt_ms) p->state_ms += dt_ms;

    if (in->ign_on == p->ign_on) p->ign_ms = 0;
    else if ((p->ign_ms = add_sat(p->ign_ms, dt_ms)) >= PDB_IGN_DEBOUNCE_MS) { p->ign_on = in->ign_on; p->ign_ms = 0; }

    p->halt_ms = in->halt ? add_sat(p->halt_ms, dt_ms) : 0;
    p->low_ms = in->batt_adc < PDB_LOWBATT_ADC ? add_sat(p->low_ms, dt_ms) : 0;

    switch (p->state) {
    case PDB_SLEEP:
        if (p->ign_on) enter(p, PDB_RUN);
        break;
    case PDB_RUN:
        if (!p->ign_on) enter(p, PDB_GRACE);
        else if (p->halt_ms >= PDB_HALT_MS) enter(p, PDB_CYCLE);
        break;
    case PDB_GRACE:
        if (p->ign_on) enter(p, PDB_RUN);
        else if (p->state_ms >= PDB_GRACE_MS || p->halt_ms >= PDB_HALT_MS || p->low_ms >= PDB_LOWBATT_MS) enter(p, PDB_CUT);
        break;
    case PDB_CUT:
        if (p->state_ms >= PDB_CUT_LED_MS) enter(p, PDB_SLEEP);
        break;
    case PDB_CYCLE:
        if (p->state_ms >= PDB_CYCLE_MS) enter(p, p->ign_on ? PDB_RUN : PDB_SLEEP);
        break;
    }
}

bool pdb_relay(const pdb_t *p) { return p->state == PDB_RUN || p->state == PDB_GRACE; }

// LED103 patterns, readable by eye: RUN short blink every 2 s, GRACE 4 Hz,
// CYCLE 1 Hz, CUT solid for 1 s, SLEEP dark.
bool pdb_led(const pdb_t *p) {
    switch (p->state) {
    case PDB_RUN:   return p->led_ms < 100;
    case PDB_GRACE: return (p->led_ms % 250u) < 125;
    case PDB_CYCLE: return (p->led_ms % 1000u) < 500;
    case PDB_CUT:   return true;
    default:        return false;
    }
}

bool pdb_can_power_down(const pdb_t *p) { return p->state == PDB_SLEEP && !p->ign_on && p->ign_ms == 0; }
