#include "opera.h"
#include <string.h>

enum { S_IDLE, S_STX, S_LEN, S_PAYLOAD, S_DLE2, S_ETX, S_CK };

void opera_parser_init(opera_parser_t *p) {
    memset(p, 0, sizeof(*p));
    p->state = S_IDLE;
}

static void raw_push(opera_parser_t *p, uint8_t b) {
    if (p->f.raw_len < OPERA_MAX_RAW) p->f.raw[p->f.raw_len++] = b;
}

opera_feed_result_t opera_parser_feed(opera_parser_t *p, uint8_t b) {
    switch (p->state) {
    case S_IDLE:
        if (b == OPERA_DLE) {
            p->f.raw_len = 0;
            p->f.payload_has_dle = false;
            raw_push(p, b);
            p->state = S_STX;
        }
        return OPERA_FEED_NONE;

    case S_STX:
        if (b == OPERA_STX) {
            raw_push(p, b);
            p->state = S_LEN;
            return OPERA_FEED_NONE;
        }
        // A DLE followed by something else — could be a new frame start.
        p->state = (b == OPERA_DLE) ? S_STX : S_IDLE;
        return OPERA_FEED_RESYNC;

    case S_LEN:
        if (b == 0 || b > OPERA_MAX_PAYLOAD) { p->state = S_IDLE; return OPERA_FEED_RESYNC; }
        p->f.len = b;
        p->idx = 0;
        p->xor_acc = b;
        raw_push(p, b);
        p->state = S_PAYLOAD;
        return OPERA_FEED_NONE;

    case S_PAYLOAD:
        p->f.payload[p->idx++] = b;
        p->xor_acc ^= b;
        raw_push(p, b);
        if (b == OPERA_DLE) p->f.payload_has_dle = true;
        if (p->idx >= p->f.len) p->state = S_DLE2;
        return OPERA_FEED_NONE;

    case S_DLE2:
        if (b != OPERA_DLE) { p->state = S_IDLE; return OPERA_FEED_RESYNC; }
        p->xor_acc ^= b;
        raw_push(p, b);
        p->state = S_ETX;
        return OPERA_FEED_NONE;

    case S_ETX:
        if (b != OPERA_ETX) { p->state = S_IDLE; return OPERA_FEED_RESYNC; }
        p->xor_acc ^= b;
        raw_push(p, b);
        p->state = S_CK;
        return OPERA_FEED_NONE;

    case S_CK:
        raw_push(p, b);
        p->state = S_IDLE;
        return (b == p->xor_acc) ? OPERA_FEED_FRAME : OPERA_FEED_BAD_CK;
    }
    p->state = S_IDLE;
    return OPERA_FEED_RESYNC;
}

void opera_decode(const opera_frame_t *f, opera_event_t *ev) {
    memset(ev, 0, sizeof(*ev));
    ev->kind = OPERA_EV_UNKNOWN;
    if (f->len == 2 && f->payload[0] == OPERA_TYPE_KNOB) {
        if (f->payload[1] == OPERA_KNOB_CW) ev->kind = OPERA_EV_KNOB_CW;
        else if (f->payload[1] == OPERA_KNOB_CCW) ev->kind = OPERA_EV_KNOB_CCW;
        return;
    }
    if (f->len == 1 + 2 * OPERA_KEY_SLOTS && f->payload[0] == OPERA_TYPE_KEYS) {
        ev->kind = OPERA_EV_KEYS;
        for (int i = 0; i < OPERA_KEY_SLOTS; i++) {
            uint16_t k = (uint16_t)(f->payload[1 + 2 * i] << 8) | f->payload[2 + 2 * i];
            if (k) ev->keys[ev->nkeys++] = k;
        }
    }
}

size_t opera_encode(const uint8_t *payload, uint8_t len, uint8_t *out, size_t out_cap) {
    size_t need = (size_t)len + 6;
    if (len == 0 || len > OPERA_MAX_PAYLOAD || out_cap < need) return 0;
    size_t i = 0;
    uint8_t ck = len;
    out[i++] = OPERA_DLE;
    out[i++] = OPERA_STX;
    out[i++] = len;
    for (uint8_t k = 0; k < len; k++) { out[i++] = payload[k]; ck ^= payload[k]; }
    out[i++] = OPERA_DLE; ck ^= OPERA_DLE;
    out[i++] = OPERA_ETX; ck ^= OPERA_ETX;
    out[i++] = ck;
    return i;
}

bool opera_key_held(const opera_event_t *ev, uint16_t key) {
    for (int i = 0; i < ev->nkeys; i++) if (ev->keys[i] == key) return true;
    return false;
}
