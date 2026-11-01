// Host-side unit test for the PDB state machine: one scenario per drive situation in
// PDB reference §4.1/§4.3. Times are simulated in 10 ms ticks. Build & run:  make -C tests
#include "../src/pdb.h"
#include <stdio.h>

static int fails = 0;
#define CHECK(cond, ...) do { if (!(cond)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

#define BATT_OK  700   // ~12.5 V
#define BATT_LOW 580   // ~10.3 V

static pdb_inputs_t in;
static pdb_t p;

// Run for ms with the current inputs; returns how many ms the relay was open.
static uint32_t run(uint32_t ms) {
    uint32_t open = 0;
    for (uint32_t t = 0; t < ms; t += PDB_TICK_MS) { pdb_tick(&p, &in, PDB_TICK_MS); if (!pdb_relay(&p)) open += PDB_TICK_MS; }
    return open;
}
static void start(bool ign) { in = (pdb_inputs_t){ .ign_on = ign, .halt = false, .batt_adc = BATT_OK }; pdb_init(&p, ign); }
#define SEC(s) ((uint32_t)(s) * 1000UL)

int main(void) {
    CHECK(PDB_LOWBATT_ADC == 616, "low-battery threshold %u, expected 616 (11.0 V)", PDB_LOWBATT_ADC);

    // Power-up both ways.
    start(false);
    CHECK(p.state == PDB_SLEEP && !pdb_relay(&p) && pdb_can_power_down(&p), "power-up, ignition off: SLEEP, relay open");
    start(true);
    CHECK(p.state == PDB_RUN && pdb_relay(&p), "power-up, ignition on: RUN, relay closed");

    // Key on: debounced, then RUN.
    start(false);
    in.ign_on = true; run(150);
    CHECK(p.state == PDB_SLEEP && !pdb_can_power_down(&p), "150 ms of ignition is not yet a key-on, but blocks power-down");
    run(100);
    CHECK(p.state == PDB_RUN && pdb_relay(&p), "key on after 250 ms: RUN");

    // A short wake-up glitch goes back to power-down.
    start(false);
    in.ign_on = true; run(50); in.ign_on = false; run(50);
    CHECK(p.state == PDB_SLEEP && pdb_can_power_down(&p), "50 ms glitch: back to power-down");

    // Cranking: a 150 ms ignition dropout must not start GRACE.
    start(true);
    in.ign_on = false; run(150); in.ign_on = true;
    CHECK(run(SEC(5)) == 0 && p.state == PDB_RUN, "cranking dropout: stays RUN");

    // Fuel stop: key off for half the grace time, back on. The relay never opens.
    start(true);
    in.ign_on = false;
    uint32_t open = run(PDB_GRACE_MS / 2);
    CHECK(p.state == PDB_GRACE, "key off: GRACE");
    in.ign_on = true; open += run(SEC(1));
    CHECK(p.state == PDB_RUN && open == 0, "fuel stop: back to RUN, relay never opened (open %lu ms)", (unsigned long)open);

    // Normal shutdown: the Pi halts mid-GRACE; the relay opens PDB_HALT_MS later.
    start(true);
    in.ign_on = false; run(PDB_GRACE_MS / 2);
    in.halt = true;
    CHECK(run(PDB_HALT_MS - 1000) == 0 && p.state == PDB_GRACE, "HALT 1 s short of the limit: still GRACE");
    run(1100);
    CHECK(p.state == PDB_CUT && !pdb_relay(&p) && pdb_led(&p), "HALT for the full time: CUT, relay open, LED on");
    run(SEC(2));
    CHECK(p.state == PDB_SLEEP && !pdb_led(&p), "CUT then SLEEP");

    // A short HALT pulse (e.g. GPIO26 used as ISP SCK) does not cut.
    start(true);
    in.ign_on = false; run(PDB_GRACE_MS / 10);
    in.halt = true; run(PDB_HALT_MS / 2); in.halt = false;
    CHECK(run(PDB_HALT_MS) == 0 && p.state == PDB_GRACE, "half-length HALT pulse: no cut");

    // Pi hangs: no HALT. Backstop PDB_GRACE_MS (5:15) after the debounced key-off.
    start(true);
    in.ign_on = false;
    run(PDB_GRACE_MS + PDB_IGN_DEBOUNCE_MS - 100);
    CHECK(p.state == PDB_GRACE && pdb_relay(&p), "just before the backstop: relay still closed");
    run(200);
    CHECK(p.state == PDB_CUT, "backstop: CUT");

    // Low battery in GRACE: PDB_LOWBATT_MS below 11.0 V cuts; 1 s less does not.
    start(true);
    in.ign_on = false; run(PDB_GRACE_MS / 10);
    in.batt_adc = BATT_LOW; run(PDB_LOWBATT_MS - 1000); in.batt_adc = BATT_OK;
    CHECK(run(SEC(2)) == 0 && p.state == PDB_GRACE, "low battery 1 s short of the limit: no cut");
    in.batt_adc = BATT_LOW; run(PDB_LOWBATT_MS + 100);
    CHECK(p.state == PDB_CUT, "low battery for the full time in GRACE: CUT");

    // Low battery while driving (cranking sag) never cuts, and does not carry into GRACE.
    start(true);
    in.batt_adc = BATT_LOW;
    CHECK(run(SEC(60)) == 0 && p.state == PDB_RUN, "low battery in RUN: no cut");
    in.ign_on = false; run(PDB_LOWBATT_MS / 2);
    CHECK(p.state == PDB_GRACE, "low battery: GRACE starts its own count");
    run(PDB_LOWBATT_MS / 2 + 1000);
    CHECK(p.state == PDB_CUT, "then cuts PDB_LOWBATT_MS into GRACE");

    // The Pi halts while driving: relay opens 5 s, then closes again.
    start(true);
    run(PDB_HALT_ARM_MS + 10);   // the Pi holds HALT LOW while it runs
    in.halt = true; run(PDB_HALT_MS + 10);
    CHECK(p.state == PDB_CYCLE && !pdb_relay(&p), "HALT in RUN: CYCLE, relay open");
    in.halt = false;   // the Pi lost power, so GPIO26 drops
    open = run(PDB_CYCLE_MS + 1000);
    CHECK(p.state == PDB_RUN && pdb_relay(&p), "after CYCLE: RUN again");
    CHECK(open + 50 >= PDB_CYCLE_MS && open <= PDB_CYCLE_MS + 50, "relay open for PDB_CYCLE_MS (%lu ms)", (unsigned long)open);

    // Key off during CYCLE: ends in SLEEP, not RUN.
    start(true);
    run(PDB_HALT_ARM_MS + 10);
    in.halt = true; run(PDB_HALT_MS + 10);
    in.halt = false; in.ign_on = false; run(PDB_CYCLE_MS + 1000);
    CHECK(p.state == PDB_SLEEP && !pdb_relay(&p), "key off during CYCLE: SLEEP");

    // J3/J103 unplugged: HALT_IN floats HIGH from power-up. It must never cycle or cut early.
    start(true);
    in.halt = true;
    CHECK(run(PDB_GRACE_MS) == 0 && p.state == PDB_RUN, "floating HALT in RUN: no CYCLE");
    in.ign_on = false; run(PDB_HALT_MS * 2);
    CHECK(p.state == PDB_GRACE, "floating HALT in GRACE: no early cut");
    run(PDB_GRACE_MS);
    CHECK(p.state == PDB_CUT || p.state == PDB_SLEEP, "floating HALT: the backstop still cuts");

    // A short LOW (a floating pin wandering) is not enough to arm.
    start(true);
    in.halt = true; run(SEC(1));
    in.halt = false; run(PDB_HALT_ARM_MS - 500);
    in.halt = true;
    CHECK(run(PDB_HALT_MS + 1000) == 0 && p.state == PDB_RUN, "LOW shorter than the arming time: not armed");

    // Arming carries from RUN into GRACE (the Pi stays powered): a normal shutdown still cuts.
    start(true);
    run(PDB_HALT_ARM_MS + 10);
    in.ign_on = false; run(SEC(1));
    in.halt = true; run(PDB_HALT_MS + 100);
    CHECK(p.state == PDB_CUT, "armed in RUN, HALT in GRACE: CUT");

    // After a CYCLE the Pi reboots, so it must arm again.
    start(true);
    run(PDB_HALT_ARM_MS + 10);
    in.halt = true; run(PDB_HALT_MS + 10);
    run(PDB_CYCLE_MS + 100);   // HALT stays HIGH: as if J103 came off during the cycle
    CHECK(p.state == PDB_RUN && run(PDB_HALT_MS * 3) == 0, "after CYCLE, HALT not trusted until LOW again");

    // LED patterns.
    start(true); run(1000);
    int on = 0; for (int i = 0; i < 200; i++) { run(10); on += pdb_led(&p); }
    CHECK(on == 10, "RUN: LED on 100 ms per 2 s (got %d ticks)", on);
    in.ign_on = false; run(SEC(1));
    on = 0; for (int i = 0; i < 100; i++) { run(10); on += pdb_led(&p); }
    CHECK(on >= 48 && on <= 52, "GRACE: LED on about half the time (got %d ticks)", on);

    if (fails) { printf("%d check(s) failed\n", fails); return 1; }
    printf("all PDB state machine tests passed\n");
    return 0;
}
