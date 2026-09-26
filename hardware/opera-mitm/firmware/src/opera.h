// OPERA frame parser/encoder — Honda audio switch panel ↔ audio unit serial link.
// Pure C, no SDK dependencies, so it can be unit-tested on the host (see ../tests).
//
// Wire format (BUILD_NOTES §30.4), 19200 8N1, idle high:
//   10 02  LEN  PAYLOAD[LEN]  10 03  CK       CK = XOR(LEN, PAYLOAD..., 10, 03)
// PAYLOAD[0] is the message type:
//   0x42  knob rotation, LEN=2:  42 0A = clockwise, 42 0B = anticlockwise
//   0x41  key report,   LEN=7:  41 then three big-endian u16 key slots (0 = empty);
//         re-sent every 192 ms while any key is held; all-zero = everything released.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define OPERA_DLE 0x10
#define OPERA_STX 0x02
#define OPERA_ETX 0x03

#define OPERA_MAX_PAYLOAD 32
#define OPERA_MAX_RAW (OPERA_MAX_PAYLOAD + 6)

#define OPERA_TYPE_KNOB 0x42
#define OPERA_TYPE_KEYS 0x41
#define OPERA_KNOB_CW 0x0A
#define OPERA_KNOB_CCW 0x0B

#define OPERA_KEY_MODE 0x006B
#define OPERA_KEY_BACK 0x006C
#define OPERA_KEY_KNOB 0x006E
#define OPERA_KEY_PHONE 0x00AA
#define OPERA_KEY_SLOTS 3

typedef struct {
    uint8_t len;                       // LEN byte (payload length)
    uint8_t payload[OPERA_MAX_PAYLOAD]; // payload[0] == type
    uint8_t raw[OPERA_MAX_RAW];        // the frame exactly as received, for transparent forwarding
    uint8_t raw_len;
    bool payload_has_dle;              // a 0x10 inside the payload — DLE stuffing is unverified (§30.5)
} opera_frame_t;

typedef struct {
    uint8_t state;
    uint8_t idx;
    uint8_t xor_acc;
    opera_frame_t f;
} opera_parser_t;

typedef enum {
    OPERA_EV_NONE = 0,
    OPERA_EV_KNOB_CW,
    OPERA_EV_KNOB_CCW,
    OPERA_EV_KEYS,      // key state report: see keys[]/nkeys
    OPERA_EV_UNKNOWN,   // valid frame, unknown type
} opera_event_kind_t;

typedef struct {
    opera_event_kind_t kind;
    uint16_t keys[OPERA_KEY_SLOTS];
    uint8_t nkeys;
} opera_event_t;

typedef enum {
    OPERA_FEED_NONE = 0,     // still collecting
    OPERA_FEED_FRAME = 1,    // a complete, checksum-verified frame is in parser->f
    OPERA_FEED_BAD_CK = -1,  // frame completed but checksum failed (frame discarded)
    OPERA_FEED_RESYNC = -2,  // unexpected byte, parser reset
} opera_feed_result_t;

void opera_parser_init(opera_parser_t *p);
opera_feed_result_t opera_parser_feed(opera_parser_t *p, uint8_t byte);
void opera_decode(const opera_frame_t *f, opera_event_t *ev);

// Builds a frame around payload[0..len). Returns bytes written to out (≥ len+6), 0 if too big.
size_t opera_encode(const uint8_t *payload, uint8_t len, uint8_t *out, size_t out_cap);
bool opera_key_held(const opera_event_t *ev, uint16_t key);
