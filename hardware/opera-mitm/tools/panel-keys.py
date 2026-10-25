#!/usr/bin/env python3
"""Type audio-panel controls into the kiosk from SSH, without the car or the Pico.

Creates a virtual keyboard through /dev/uinput and sends the same keys the OPERA MITM
firmware sends (firmware/src/config.h), so the web app's control mapping can be bench-tested
while someone watches the screen. Standard library only; run as root.

    sudo ./panel-keys.py cw cw cw push back
    sudo ./panel-keys.py --gap 1.5 ccw push mode phone

Controls: cw ccw push back mode phone. `push` is held for --hold seconds.
"""
import argparse
import fcntl
import os
import struct
import time

KEYS = {  # linux/input-event-codes.h
    'cw': 106,     # KEY_RIGHT
    'ccw': 105,    # KEY_LEFT
    'push': 28,    # KEY_ENTER
    'back': 1,     # KEY_ESC
    'mode': 50,    # KEY_M
    'phone': 25,   # KEY_P
}

EV_SYN, EV_KEY, SYN_REPORT = 0, 1, 0
UI_SET_EVBIT = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_DEV_SETUP = 0x405C5503   # _IOW('U', 3, struct uinput_setup), 92 bytes
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502
BUS_VIRTUAL = 0x06


def emit(fd, etype, code, value):
    os.write(fd, struct.pack('llHHi', 0, 0, etype, code, value))


def key(fd, code, down):
    emit(fd, EV_KEY, code, 1 if down else 0)
    emit(fd, EV_SYN, SYN_REPORT, 0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('controls', nargs='+', choices=sorted(KEYS))
    p.add_argument('--gap', type=float, default=1.0, help='seconds between controls (default 1.0)')
    p.add_argument('--hold', type=float, default=0.15, help='seconds a button is held (default 0.15)')
    args = p.parse_args()

    fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
    try:
        fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
        for code in KEYS.values():
            fcntl.ioctl(fd, UI_SET_KEYBIT, code)
        name = b'panel-keys virtual panel'
        fcntl.ioctl(fd, UI_DEV_SETUP, struct.pack('HHHH80sI', BUS_VIRTUAL, 0x1234, 0x5678, 1, name, 0))
        fcntl.ioctl(fd, UI_DEV_CREATE)
        time.sleep(1.0)  # let cage/libinput open the new device before the first key

        for i, c in enumerate(args.controls):
            if i:
                time.sleep(args.gap)
            code = KEYS[c]
            key(fd, code, True)
            # The knob's key is a 25 ms pulse in the firmware; buttons are held.
            time.sleep(0.025 if c in ('cw', 'ccw') else args.hold)
            key(fd, code, False)
            print(c, flush=True)
        time.sleep(0.2)
    finally:
        fcntl.ioctl(fd, UI_DEV_DESTROY)
        os.close(fd)


if __name__ == '__main__':
    main()
