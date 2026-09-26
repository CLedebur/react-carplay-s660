// Pin map and tunables. Matches hardware/opera-mitm/tap-board.md ("Pico pin map").
#pragma once

// Inputs
#define PIN_PW_IN     2    // PWR SW via 2N7000 buffer: HIGH = pressed (inverted)
#define PIN_TX_IN     5    // panel's OPERA TX (UART1 RX)
#define PIN_RX_IN    13    // head unit's OPERA RX line (UART0 RX) — also our "car is on" sense
#define PIN_CONT_ADC 26    // OPERA CONT via 68k/15k, ADC0

// Outputs (all drive 2N7000 gates: HIGH = line pulled low)
#define PIN_TX_OUT    4    // to head unit's OPERA TX input (UART1 TX, inverted at the pad)
#define PIN_PW_OUT    3    // to head unit's PWR SW input
#define PIN_RLY       6    // bypass relays (HIGH = energised = Pico in the path)
#define PIN_RST       7    // CM4 RUN_PG (HIGH = held in reset)

#define OPERA_BAUD 19200

// Behaviour
#define PW_DEBOUNCE_MS       20
#define PW_HOLD_REBOOT_MS  3000   // hold Power this long → reset the CM4
#define RST_PULSE_MS        200
#define KNOB_KEY_PULSE_MS    25   // how long a knob click "presses" its key
#define RELAY_ENGAGE_MS    1500   // after boot, before the relays pull the Pico into the path
#define WATCHDOG_MS        2000

// HID keycodes for CarPlay mode (Chromium sees a plain USB keyboard).
// The web app maps these to CarPlay commands; keep them boring and unambiguous.
#define KEY_KNOB_CW    HID_KEY_ARROW_RIGHT
#define KEY_KNOB_CCW   HID_KEY_ARROW_LEFT
#define KEY_KNOB_PUSH  HID_KEY_ENTER
#define KEY_BACK       HID_KEY_ESCAPE
#define KEY_MODE       HID_KEY_M
#define KEY_PHONE      HID_KEY_P
