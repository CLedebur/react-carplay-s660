// Host-side unit test for the OPERA parser. Frames are the ones captured on the car
// (BUILD_NOTES §30.4/§30.5). Build & run:  make -C tests
#include "../src/opera.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static int fails = 0;
#define CHECK(cond, ...) do { if (!(cond)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static const uint8_t knob_cw[]   = {0x10,0x02,0x02,0x42,0x0A,0x10,0x03,0x59};
static const uint8_t knob_ccw[]  = {0x10,0x02,0x02,0x42,0x0B,0x10,0x03,0x58};
static const uint8_t key_knob[]  = {0x10,0x02,0x07,0x41,0x00,0x6E,0x00,0x00,0x00,0x00,0x10,0x03,0x3B};
static const uint8_t key_back[]  = {0x10,0x02,0x07,0x41,0x00,0x6C,0x00,0x00,0x00,0x00,0x10,0x03,0x39};
static const uint8_t key_mode[]  = {0x10,0x02,0x07,0x41,0x00,0x6B,0x00,0x00,0x00,0x00,0x10,0x03,0x3E};
static const uint8_t key_phone[] = {0x10,0x02,0x07,0x41,0x00,0xAA,0x00,0x00,0x00,0x00,0x10,0x03,0xFF};
static const uint8_t key_both[]  = {0x10,0x02,0x07,0x41,0x00,0x6C,0x00,0x6E,0x00,0x00,0x10,0x03,0x57};
static const uint8_t key_none[]  = {0x10,0x02,0x07,0x41,0x00,0x00,0x00,0x00,0x00,0x00,0x10,0x03,0x55};

static int feed_all(opera_parser_t *p, const uint8_t *b, size_t n, opera_event_t *ev) {
    int frames = 0;
    for (size_t i = 0; i < n; i++) {
        opera_feed_result_t r = opera_parser_feed(p, b[i]);
        CHECK(r != OPERA_FEED_BAD_CK, "bad checksum at byte %zu", i);
        if (r == OPERA_FEED_FRAME) { opera_decode(&p->f, ev); frames++; }
    }
    return frames;
}

int main(void) {
    opera_parser_t p; opera_event_t ev;
    opera_parser_init(&p);

    CHECK(feed_all(&p, knob_cw, sizeof knob_cw, &ev) == 1 && ev.kind == OPERA_EV_KNOB_CW, "knob cw");
    CHECK(p.f.raw_len == sizeof knob_cw && memcmp(p.f.raw, knob_cw, sizeof knob_cw) == 0, "raw copy");
    CHECK(feed_all(&p, knob_ccw, sizeof knob_ccw, &ev) == 1 && ev.kind == OPERA_EV_KNOB_CCW, "knob ccw");

    CHECK(feed_all(&p, key_knob, sizeof key_knob, &ev) == 1 && ev.kind == OPERA_EV_KEYS && ev.nkeys == 1 && ev.keys[0] == OPERA_KEY_KNOB, "knob push");
    CHECK(feed_all(&p, key_back, sizeof key_back, &ev) == 1 && ev.nkeys == 1 && ev.keys[0] == OPERA_KEY_BACK, "back");
    CHECK(feed_all(&p, key_mode, sizeof key_mode, &ev) == 1 && ev.keys[0] == OPERA_KEY_MODE, "mode");
    CHECK(feed_all(&p, key_phone, sizeof key_phone, &ev) == 1 && ev.keys[0] == OPERA_KEY_PHONE, "phone");
    CHECK(feed_all(&p, key_both, sizeof key_both, &ev) == 1 && ev.nkeys == 2 && opera_key_held(&ev, OPERA_KEY_BACK) && opera_key_held(&ev, OPERA_KEY_KNOB), "two keys");
    CHECK(feed_all(&p, key_none, sizeof key_none, &ev) == 1 && ev.kind == OPERA_EV_KEYS && ev.nkeys == 0, "release");

    // Back-to-back frames as captured (repeat + release in one burst)
    uint8_t burst[sizeof key_back + sizeof key_none];
    memcpy(burst, key_back, sizeof key_back); memcpy(burst + sizeof key_back, key_none, sizeof key_none);
    opera_parser_init(&p);
    CHECK(feed_all(&p, burst, sizeof burst, &ev) == 2 && ev.nkeys == 0, "burst of two");

    // Corrupted checksum is rejected, and the parser recovers on the next frame
    uint8_t bad[sizeof key_back]; memcpy(bad, key_back, sizeof bad); bad[5] ^= 0x01;
    opera_parser_init(&p);
    int badck = 0, frames = 0;
    for (size_t i = 0; i < sizeof bad; i++) { int r = opera_parser_feed(&p, bad[i]); if (r == OPERA_FEED_BAD_CK) badck++; if (r == OPERA_FEED_FRAME) frames++; }
    CHECK(badck == 1 && frames == 0, "corrupted frame rejected");
    CHECK(feed_all(&p, knob_cw, sizeof knob_cw, &ev) == 1, "recovers after bad frame");

    // Garbage / lone 0x55 (seen at ACC-on) doesn't produce frames
    opera_parser_init(&p);
    const uint8_t junk[] = {0x55, 0x00, 0xFF, 0x10, 0x10, 0x02, 0x02, 0x42, 0x0A, 0x10, 0x03, 0x59};
    CHECK(feed_all(&p, junk, sizeof junk, &ev) == 1 && ev.kind == OPERA_EV_KNOB_CW, "junk then frame");

    // Encoder reproduces the captured bytes exactly
    uint8_t out[32];
    const uint8_t pl[] = {0x41,0x00,0x6C,0x00,0x6E,0x00,0x00};
    size_t n = opera_encode(pl, sizeof pl, out, sizeof out);
    CHECK(n == sizeof key_both && memcmp(out, key_both, n) == 0, "encode two-key report");
    const uint8_t pk[] = {0x42,0x0B};
    n = opera_encode(pk, sizeof pk, out, sizeof out);
    CHECK(n == sizeof knob_ccw && memcmp(out, knob_ccw, n) == 0, "encode knob ccw");

    printf(fails ? "%d FAILED\n" : "all OK\n", fails);
    return fails ? 1 : 0;
}
