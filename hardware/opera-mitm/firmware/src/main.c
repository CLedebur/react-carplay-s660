// OPERA MITM — sits between the S660's audio switch panel and the audio unit.
//
//  CARPLAY mode (default at boot): panel messages are decoded and sent to the CM4 as USB
//     keyboard events; nothing is forwarded to the head unit.
//  HEADUNIT mode: every byte from the panel is forwarded to the head unit unchanged, and the
//     PWR SW line is mirrored, so the stock controls work as if we weren't here.
//  Back held + Power tapped → toggle mode (the Power tap is never passed to the head unit).
//  Power held 3 s → pulse the CM4's RUN pin (hard reset; Overlay FS makes that safe).
//  A USB CDC console (/dev/ttyACM*) logs everything and takes one-letter commands.
//
// See hardware/opera-mitm/tap-board.md for the wiring and BUILD_NOTES §30 for the protocol.

#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include "pico/stdlib.h"
#include "pico/time.h"
#include "hardware/uart.h"
#include "hardware/gpio.h"
#include "hardware/adc.h"
#include "hardware/irq.h"
#include "hardware/watchdog.h"
#include "tusb.h"
#include "config.h"
#include "opera.h"

typedef enum { MODE_CARPLAY = 0, MODE_HEADUNIT = 1 } ctl_mode_t;

static ctl_mode_t mode = MODE_CARPLAY;
static opera_parser_t parser;
static opera_event_t held;              // last key report from the panel
static bool back_held = false;

// ---- ring buffers filled from the UART IRQs ----------------------------------------------
#define RB_SIZE 256
typedef struct { volatile uint8_t buf[RB_SIZE]; volatile uint16_t head, tail; } rb_t;
static rb_t rb_panel, rb_hu;

static inline void rb_push(rb_t *r, uint8_t b) {
    uint16_t n = (uint16_t)((r->head + 1) % RB_SIZE);
    if (n != r->tail) { r->buf[r->head] = b; r->head = n; }
}
static inline bool rb_pop(rb_t *r, uint8_t *b) {
    if (r->head == r->tail) return false;
    *b = r->buf[r->tail];
    r->tail = (uint16_t)((r->tail + 1) % RB_SIZE);
    return true;
}
static void on_uart1(void) { while (uart_is_readable(uart1)) rb_push(&rb_panel, uart_getc(uart1)); }
static void on_uart0(void) { while (uart_is_readable(uart0)) rb_push(&rb_hu, uart_getc(uart0)); }

// ---- console -----------------------------------------------------------------------------
static void log_line(const char *fmt, ...) {
    char buf[200];
    va_list ap; va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (n <= 0) return;
    if (n > (int)sizeof buf - 2) n = sizeof buf - 2;
    buf[n++] = '\n';
    if (tud_cdc_connected()) { tud_cdc_write(buf, (uint32_t)n); tud_cdc_write_flush(); }
}
static void log_hex(const char *tag, const uint8_t *b, size_t n) {
    char line[160]; size_t o = 0;
    o += (size_t)snprintf(line, sizeof line, "%s", tag);
    for (size_t i = 0; i < n && o < sizeof line - 4; i++) o += (size_t)snprintf(line + o, sizeof line - o, " %02X", b[i]);
    log_line("%s", line);
}

// ---- HID keyboard --------------------------------------------------------------------------
static uint8_t hid_report[6];
static bool hid_dirty = false;

static void hid_set_key(uint8_t code, bool on) {
    int slot = -1, empty = -1;
    for (int i = 0; i < 6; i++) { if (hid_report[i] == code) slot = i; else if (!hid_report[i] && empty < 0) empty = i; }
    if (on && slot < 0 && empty >= 0) { hid_report[empty] = code; hid_dirty = true; }
    if (!on && slot >= 0) { hid_report[slot] = 0; hid_dirty = true; }
}
static void hid_release_all(void) { memset(hid_report, 0, sizeof hid_report); hid_dirty = true; }
static void hid_service(void) {
    if (hid_dirty && tud_hid_ready()) { tud_hid_keyboard_report(0, 0, hid_report); hid_dirty = false; }
}

static uint8_t opera_to_hid(uint16_t k) {
    switch (k) {
    case OPERA_KEY_KNOB:  return KEY_KNOB_PUSH;
    case OPERA_KEY_BACK:  return KEY_BACK;
    case OPERA_KEY_MODE:  return KEY_MODE;
    case OPERA_KEY_PHONE: return KEY_PHONE;
    default: return 0;
    }
}

// Knob clicks become short key pulses, queued so fast spins don't lose steps.
static int knob_pending_cw = 0, knob_pending_ccw = 0;
static uint8_t knob_active = 0;
static absolute_time_t knob_t;
static bool knob_gap = false;

static void knob_service(void) {
    if (knob_active) {
        if (absolute_time_diff_us(knob_t, get_absolute_time()) < KNOB_KEY_PULSE_MS * 1000) return;
        if (!knob_gap) { hid_set_key(knob_active, false); knob_gap = true; knob_t = get_absolute_time(); return; }
        knob_active = 0; knob_gap = false;
    }
    uint8_t next = 0;
    if (knob_pending_cw > 0) { knob_pending_cw--; next = KEY_KNOB_CW; }
    else if (knob_pending_ccw > 0) { knob_pending_ccw--; next = KEY_KNOB_CCW; }
    if (next) { knob_active = next; hid_set_key(next, true); knob_t = get_absolute_time(); }
}

// ---- head unit side ------------------------------------------------------------------------
static void hu_send_frame(const uint8_t *payload, uint8_t len) {
    uint8_t out[OPERA_MAX_RAW];
    size_t n = opera_encode(payload, len, out, sizeof out);
    for (size_t i = 0; i < n; i++) uart_putc_raw(uart1, out[i]);
}
static void hu_send_release(void) {
    static const uint8_t none[] = {OPERA_TYPE_KEYS, 0, 0, 0, 0, 0, 0};
    hu_send_frame(none, sizeof none);
}

static inline bool car_on(void) { return gpio_get(PIN_RX_IN); }   // the head unit holds RX at 5 V only with ACC on

static void set_mode(ctl_mode_t m, const char *why) {
    if (m == mode) return;
    mode = m;
    if (mode == MODE_HEADUNIT) {
        hid_release_all();
        knob_pending_cw = knob_pending_ccw = 0;
    } else {
        hu_send_release();   // don't leave the head unit thinking a key is still down
    }
    log_line("MODE %s (%s)", mode == MODE_CARPLAY ? "carplay" : "headunit", why);
}

// ---- PWR SW --------------------------------------------------------------------------------
static bool pw_raw_prev, pw_stable, pw_synced = false;
static absolute_time_t pw_change_t, pw_press_t;
static bool pw_swallow = false, pw_rst_done = false;
static absolute_time_t rst_until; static bool rst_active = false;

static void cm4_reset_pulse(const char *why) {
    gpio_put(PIN_RST, 1); rst_active = true;
    rst_until = make_timeout_time_ms(RST_PULSE_MS);
    log_line("RESET CM4 (%s)", why);
}

static void pw_edge(bool pressed) {
    if (!car_on()) return;   // with the car off the line sits at 0 V and reads as "pressed"
    if (pressed) {
        pw_press_t = get_absolute_time(); pw_rst_done = false;
        pw_swallow = back_held;
        if (pw_swallow) log_line("PWR press swallowed (Back held)");
        else { gpio_put(PIN_PW_OUT, 1); log_line("PWR press -> head unit"); }
    } else {
        gpio_put(PIN_PW_OUT, 0);
        if (pw_swallow) { set_mode(mode == MODE_CARPLAY ? MODE_HEADUNIT : MODE_CARPLAY, "back+power"); pw_swallow = false; }
        else log_line("PWR release");
    }
}

static void pw_service(void) {
    bool raw = gpio_get(PIN_PW_IN);
    absolute_time_t now = get_absolute_time();
    if (!pw_synced) { pw_raw_prev = pw_stable = raw; pw_change_t = now; pw_synced = true; return; }
    if (raw != pw_raw_prev) { pw_raw_prev = raw; pw_change_t = now; }
    else if (raw != pw_stable && absolute_time_diff_us(pw_change_t, now) >= PW_DEBOUNCE_MS * 1000) { pw_stable = raw; pw_edge(raw); }

    if (pw_stable && !pw_swallow && !pw_rst_done && absolute_time_diff_us(pw_press_t, now) >= (int64_t)PW_HOLD_REBOOT_MS * 1000) {
        pw_rst_done = true;
        cm4_reset_pulse("power held");
    }
    if (rst_active && absolute_time_diff_us(get_absolute_time(), rst_until) <= 0) { gpio_put(PIN_RST, 0); rst_active = false; }
}

// ---- panel messages ------------------------------------------------------------------------
static void on_panel_event(const opera_event_t *ev) {
    switch (ev->kind) {
    case OPERA_EV_KNOB_CW:  if (mode == MODE_CARPLAY) knob_pending_cw++;  log_line("KNOB cw");  break;
    case OPERA_EV_KNOB_CCW: if (mode == MODE_CARPLAY) knob_pending_ccw++; log_line("KNOB ccw"); break;
    case OPERA_EV_KEYS: {
        bool changed = ev->nkeys != held.nkeys || memcmp(ev->keys, held.keys, sizeof ev->keys) != 0;
        if (changed) {
            // release keys no longer listed, press new ones
            for (int i = 0; i < held.nkeys; i++) if (!opera_key_held(ev, held.keys[i])) { uint8_t h = opera_to_hid(held.keys[i]); if (h && mode == MODE_CARPLAY) hid_set_key(h, false); log_line("KEY %04X up", held.keys[i]); }
            for (int i = 0; i < ev->nkeys; i++) if (!opera_key_held(&held, ev->keys[i])) { uint8_t h = opera_to_hid(ev->keys[i]); if (h && mode == MODE_CARPLAY) hid_set_key(h, true); log_line("KEY %04X down", ev->keys[i]); }
            held = *ev;
            back_held = opera_key_held(&held, OPERA_KEY_BACK);
        }
        break;
    }
    default: break;
    }
}

static void panel_service(void) {
    uint8_t b;
    while (rb_pop(&rb_panel, &b)) {
        if (mode == MODE_HEADUNIT) uart_putc_raw(uart1, b);   // transparent forwarding
        opera_feed_result_t r = opera_parser_feed(&parser, b);
        if (r == OPERA_FEED_FRAME) {
            opera_event_t ev; opera_decode(&parser.f, &ev);
            if (parser.f.payload_has_dle) log_hex("DLE-IN-PAYLOAD", parser.f.raw, parser.f.raw_len);
            if (ev.kind == OPERA_EV_UNKNOWN) log_hex("UNKNOWN", parser.f.raw, parser.f.raw_len);
            on_panel_event(&ev);
        } else if (r == OPERA_FEED_BAD_CK) {
            log_hex("BAD-CK", parser.f.raw, parser.f.raw_len);
        }
    }
    while (rb_pop(&rb_hu, &b)) log_line("HU-RX %02X", b);   // the head unit has never spoken; log it if it does
}

// ---- console commands ----------------------------------------------------------------------
static void status(void) {
    adc_select_input(0);
    uint32_t mv = adc_read() * 3300u / 4095u;
    log_line("STATUS mode=%s car=%d cont=%lumV pw=%d back=%d relay=%d usb=%d keys=%d",
         mode == MODE_CARPLAY ? "carplay" : "headunit", car_on(), (unsigned long)mv, pw_stable, back_held,
         gpio_get(PIN_RLY), tud_mounted(), held.nkeys);
}

static void console_service(void) {
    while (tud_cdc_available()) {
        char c = (char)tud_cdc_read_char();
        switch (c) {
        case 'c': set_mode(MODE_CARPLAY, "console"); break;
        case 'h': set_mode(MODE_HEADUNIT, "console"); break;
        case 't': set_mode(mode == MODE_CARPLAY ? MODE_HEADUNIT : MODE_CARPLAY, "console"); break;
        case 's': status(); break;
        case 'r': cm4_reset_pulse("console"); break;
        case 'p': gpio_put(PIN_PW_OUT, 1); sleep_ms(200); gpio_put(PIN_PW_OUT, 0); log_line("fake PWR press sent"); break;
        case 'k': hid_set_key(HID_KEY_ENTER, true); hid_service(); sleep_ms(30); hid_set_key(HID_KEY_ENTER, false); log_line("test key sent"); break;
        case '?': log_line("c=carplay h=headunit t=toggle s=status r=reset-cm4 p=fake-power k=test-key"); break;
        default: break;
        }
    }
}

// ---- TinyUSB callbacks ----------------------------------------------------------------------
uint16_t tud_hid_get_report_cb(uint8_t itf, uint8_t id, hid_report_type_t type, uint8_t *buf, uint16_t len) {
    (void)itf; (void)id; (void)type; (void)buf; (void)len; return 0;
}
void tud_hid_set_report_cb(uint8_t itf, uint8_t id, hid_report_type_t type, uint8_t const *buf, uint16_t len) {
    (void)itf; (void)id; (void)type; (void)buf; (void)len;
}

// ---- init ------------------------------------------------------------------------------------
static void uart_setup(void) {
    uart_init(uart1, OPERA_BAUD);
    gpio_set_function(PIN_TX_OUT, UART_FUNCSEL_NUM(uart1, PIN_TX_OUT));
    gpio_set_function(PIN_TX_IN, UART_FUNCSEL_NUM(uart1, PIN_TX_IN));
    gpio_set_outover(PIN_TX_OUT, GPIO_OVERRIDE_INVERT);   // MOSFET driver: UART idle-high must leave the gate low
    uart_set_format(uart1, 8, 1, UART_PARITY_NONE);
    uart_set_fifo_enabled(uart1, false);
    irq_set_exclusive_handler(UART1_IRQ, on_uart1);
    irq_set_enabled(UART1_IRQ, true);
    uart_set_irq_enables(uart1, true, false);

    uart_init(uart0, OPERA_BAUD);
    gpio_set_function(PIN_RX_IN, UART_FUNCSEL_NUM(uart0, PIN_RX_IN));
    uart_set_format(uart0, 8, 1, UART_PARITY_NONE);
    uart_set_fifo_enabled(uart0, false);
    irq_set_exclusive_handler(UART0_IRQ, on_uart0);
    irq_set_enabled(UART0_IRQ, true);
    uart_set_irq_enables(uart0, true, false);
}

static void gpio_setup(void) {
    const uint outs[] = {PIN_PW_OUT, PIN_RLY, PIN_RST};
    for (size_t i = 0; i < sizeof outs / sizeof outs[0]; i++) { gpio_init(outs[i]); gpio_put(outs[i], 0); gpio_set_dir(outs[i], GPIO_OUT); }
    gpio_init(PIN_PW_IN); gpio_set_dir(PIN_PW_IN, GPIO_IN); gpio_pull_down(PIN_PW_IN);
    adc_init(); adc_gpio_init(PIN_CONT_ADC);
}

int main(void) {
    gpio_setup();          // outputs low before anything else
    uart_setup();
    opera_parser_init(&parser);
    tusb_init();

    absolute_time_t boot = get_absolute_time();
    bool relay_done = false, hello = false;
    watchdog_enable(WATCHDOG_MS, true);

    while (true) {
        watchdog_update();
        tud_task();
        if (!hello && tud_cdc_connected()) { hello = true; log_line("OPERA MITM up; '?' for commands"); status(); }
        if (!relay_done && absolute_time_diff_us(boot, get_absolute_time()) > (int64_t)RELAY_ENGAGE_MS * 1000) {
            gpio_put(PIN_RLY, 1); relay_done = true; log_line("relays engaged");
        }
        panel_service();
        pw_service();
        knob_service();
        hid_service();
        console_service();
    }
}
