// S660-PDB power supervisor — ATtiny85 (U1 on the PDB boards, U101 on the Buddy Board).
// Hardware glue only; the behaviour is the state machine in pdb.c.
//
// Pins (rev D, PDB reference §5 / §9.1):
//   PB0  pin 5  COIL_DRV   out  HIGH = relay closed (also ISP MOSI)
//   PB1  pin 6  LED3_DRV   out  heartbeat LED (also ISP MISO)
//   PB2  pin 7  HALT_IN    in   HIGH = the Pi has halted (also ISP SCK)
//   PB3  pin 2  BATT_SENSE ADC3, 12V_IN × 15/83
//   PB4  pin 3  IGN_MCU    in   LOW = ACC or ON present; pin-change wake
//   PB5  pin 1  RESET      ISP only. Never set RSTDISBL.
//
// Clock: internal 8 MHz RC (lfuse 0xE2). The 10 ms tick is Timer0 in CTC mode. In RUN,
// GRACE, CUT and CYCLE the CPU idles between ticks; in SLEEP it powers down and only an
// ignition change wakes it. The watchdog resets a hung CPU while the relay can be closed.
#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <avr/power.h>
#include "pdb.h"

#define PIN_COIL PB0
#define PIN_LED  PB1
#define PIN_HALT PB2
#define PIN_IGN  PB4

static volatile uint8_t ticks;

ISR(TIM0_COMPA_vect) { ticks++; }
EMPTY_INTERRUPT(PCINT0_vect)   // only here to wake from power-down

// A watchdog reset leaves WDRF set, which keeps the watchdog running at its shortest
// timeout; clear it before main() so a reset can't turn into a reset loop.
void wdt_early_off(void) __attribute__((naked, used, section(".init3")));
void wdt_early_off(void) { MCUSR = 0; wdt_disable(); }

static uint16_t batt_read(void) {
    uint16_t sum = 0;
    for (uint8_t i = 0; i < 4; i++) {
        ADCSRA |= _BV(ADSC);
        while (ADCSRA & _BV(ADSC)) {}
        sum += ADC;
    }
    return sum / 4;
}

static void read_inputs(pdb_inputs_t *in) {
    uint8_t pins = PINB;
    in->ign_on = !(pins & _BV(PIN_IGN));
    in->halt = pins & _BV(PIN_HALT);
    in->batt_adc = batt_read();
}

static void outputs(bool relay, bool led) {
    uint8_t o = PORTB & ~(_BV(PIN_COIL) | _BV(PIN_LED));
    if (relay) o |= _BV(PIN_COIL);
    if (led) o |= _BV(PIN_LED);
    PORTB = o;
}

static void power_down(void) {
    outputs(false, false);
    ADCSRA &= ~_BV(ADEN);
    wdt_disable();
    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    cli();
    if (PINB & _BV(PIN_IGN)) {   // ignition still off: sleep (re-checked with interrupts off)
        sleep_enable();
#ifdef sleep_bod_disable
        sleep_bod_disable();     // BOD off while asleep saves ~20 µA
#endif
        sei();
        sleep_cpu();
        sleep_disable();
    }
    sei();
    ADCSRA |= _BV(ADEN);
    wdt_enable(WDTO_1S);
    ticks = 0;
}

int main(void) {
    clock_prescale_set(clock_div_1);   // 8 MHz even if the CKDIV8 fuse is still set
    power_timer1_disable();
    power_usi_disable();

    DDRB = _BV(PIN_COIL) | _BV(PIN_LED);
    PORTB = 0;                         // outputs low, inputs without pull-ups (both have
                                       // external pulls: R112 on IGN, the Pi on HALT)
    DIDR0 = _BV(ADC3D);
    ADMUX = 3;                         // ADC3, VCC reference
    ADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1);   // 8 MHz / 64 = 125 kHz

    TCCR0A = _BV(WGM01);               // CTC
    OCR0A = 77;                        // 8 MHz / 1024 / 78 = 100.16 Hz
    TCCR0B = _BV(CS02) | _BV(CS00);
    TIMSK = _BV(OCIE0A);

    PCMSK = _BV(PCINT4);
    GIMSK = _BV(PCIE);

    pdb_t p;
    pdb_inputs_t in;
    read_inputs(&in);
    pdb_init(&p, in.ign_on);
    outputs(pdb_relay(&p), pdb_led(&p));

    wdt_enable(WDTO_1S);
    sei();

    for (;;) {
        while (ticks) {
            cli(); ticks--; sei();
            read_inputs(&in);
            pdb_tick(&p, &in, PDB_TICK_MS);
            outputs(pdb_relay(&p), pdb_led(&p));
        }
        wdt_reset();
        if (pdb_can_power_down(&p) && (PINB & _BV(PIN_IGN))) {
            power_down();
        } else {
            set_sleep_mode(SLEEP_MODE_IDLE);
            sleep_mode();
        }
    }
}
