"""Hole-accurate breadboard drawing of the provisional OPERA MITM (half-size, 30 rows)."""
import sys

P = 20                      # hole pitch in px
X0, Y0 = 150, 70            # position of row 1 / left "-" rail hole
COLS = {'-L': 0, '+L': 1, 'a': 3, 'b': 4, 'c': 5, 'd': 6, 'e': 7, 'f': 10, 'g': 11, 'h': 12, 'i': 13, 'j': 14, '+R': 16, '-R': 17}
NROWS = 30

def hx(col): return X0 + COLS[col] * P
def hy(row): return Y0 + (row - 1) * P

out = []
def add(s): out.append(s)

# ---- board ----
bw = (COLS['-R'] + 1) * P + 20
add(f'<rect x="{X0-30}" y="{Y0-30}" width="{bw+20}" height="{NROWS*P+40}" rx="8" fill="#F4F1EA" stroke="#B8B2A5" stroke-width="1"/>')
# centre gap
add(f'<rect x="{hx("e")+P/2}" y="{Y0-20}" width="{hx("f")-hx("e")-P}" height="{NROWS*P+20}" fill="#E8E4DA"/>')
# rail lines
for col, color in (('-L', '#2A6DB5'), ('+L', '#C0392B'), ('+R', '#C0392B'), ('-R', '#2A6DB5')):
    x = hx(col) + (-9 if col.startswith('-') else 9) * (1 if col.endswith('L') else -1) * (-1 if col == '-L' else 1) * 0 + 0
    add(f'<line x1="{hx(col)}" y1="{Y0-14}" x2="{hx(col)}" y2="{hy(NROWS)+14}" stroke="{color}" stroke-width="1" opacity="0.5"/>')
add(f'<text x="{hx("-L")}" y="{Y0-18}" text-anchor="middle" font-size="11" fill="#2A6DB5">−</text>')
add(f'<text x="{hx("+L")}" y="{Y0-18}" text-anchor="middle" font-size="11" fill="#C0392B">+</text>')
add(f'<text x="{hx("+R")}" y="{Y0-18}" text-anchor="middle" font-size="11" fill="#C0392B">+</text>')
add(f'<text x="{hx("-R")}" y="{Y0-18}" text-anchor="middle" font-size="11" fill="#2A6DB5">−</text>')
# holes + labels
for col in ['-L', '+L', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '+R', '-R']:
    for r in range(1, NROWS + 1):
        add(f'<circle cx="{hx(col)}" cy="{hy(r)}" r="3" fill="#FFFFFF" stroke="#9C968A" stroke-width="0.7"/>')
for col in 'abcdefghij':
    add(f'<text x="{hx(col)}" y="{Y0-18}" text-anchor="middle" font-size="11" fill="#555">{col}</text>')
for r in range(1, NROWS + 1):
    add(f'<text x="{hx("a")-16}" y="{hy(r)+4}" text-anchor="end" font-size="10" fill="#777">{r}</text>')
    add(f'<text x="{hx("j")+16}" y="{hy(r)+4}" text-anchor="start" font-size="10" fill="#777">{r}</text>')

# ---- parts ----
def resistor(c1, r1, c2, r2, label, color='#D8C8A0'):
    x1, y1, x2, y2 = hx(c1), hy(r1), hx(c2), hy(r2)
    add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#666" stroke-width="1.2"/>')
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    if x1 == x2:   # vertical
        add(f'<rect x="{mx-6}" y="{my-14}" width="12" height="28" rx="3" fill="{color}" stroke="#8A7A50" stroke-width="0.8"/>')
        add(f'<text x="{mx+10}" y="{my+4}" text-anchor="start" font-size="10" fill="#222">{label}</text>')
    else:          # horizontal
        add(f'<rect x="{mx-14}" y="{my-6}" width="28" height="12" rx="3" fill="{color}" stroke="#8A7A50" stroke-width="0.8"/>')
        add(f'<text x="{mx}" y="{my-9}" text-anchor="middle" font-size="10" fill="#222">{label}</text>')

def zener(c, r1, r2, label):
    x, y1, y2 = hx(c), hy(r1), hy(r2)
    add(f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="#666" stroke-width="1.2"/>')
    my = (y1 + y2) / 2
    add(f'<rect x="{x-6}" y="{my-14}" width="12" height="28" rx="3" fill="#EFE6FA" stroke="#7A4DB5" stroke-width="0.8"/>')
    add(f'<line x1="{x-6}" y1="{my-10}" x2="{x+6}" y2="{my-10}" stroke="#222" stroke-width="2.5"/>')
    add(f'<text x="{x-9}" y="{my+4}" text-anchor="end" font-size="10" fill="#222">{label}</text>')

def fet(c, r_s, r_g, r_d, name):
    x = hx(c); ys, yd = hy(r_s), hy(r_d)
    top, bot = min(ys, yd), max(ys, yd)
    add(f'<rect x="{x-9}" y="{top-8}" width="18" height="{bot-top+16}" rx="5" fill="#DFF5F1" stroke="#1F8A78" stroke-width="0.8"/>')
    for r, l in ((r_s, 'S'), (r_g, 'G'), (r_d, 'D')):
        add(f'<circle cx="{x}" cy="{hy(r)}" r="3" fill="#1F8A78"/>')
        add(f'<text x="{x+12}" y="{hy(r)+4}" text-anchor="start" font-size="10" fill="#0B4A40">{l}</text>')
    add(f'<text x="{x-13}" y="{hy(r_g)+4}" text-anchor="end" font-size="10" fill="#0B4A40">{name}</text>')

def jumper(c1, r1, c2, r2, color):
    add(f'<path d="M{hx(c1)} {hy(r1)} C {hx(c1)+ (hx(c2)-hx(c1))*0.25} {hy(r1)}, {hx(c2)-(hx(c2)-hx(c1))*0.25} {hy(r2)}, {hx(c2)} {hy(r2)}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round"/>')
    for c, r in ((c1, r1), (c2, r2)): add(f'<circle cx="{hx(c)}" cy="{hy(r)}" r="3" fill="{color}"/>')

def hline(xa, xb, y, color):
    # straight wire that hops over any rail column it crosses (so it never looks connected to a rail)
    rails = sorted(hx(c) for c in ('-L', '+L', '+R', '-R') if min(xa, xb) < hx(c) < max(xa, xb))
    d = f'M{xa} {y}'
    cur = xa
    for rx in rails:
        d += f' L{rx-6} {y} A6 6 0 0 1 {rx+6} {y}'
        cur = rx + 6
    d += f' L{xb} {y}'
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round"/>')

def ext_left(c, r, label, color):   # wire from the left edge into a hole
    x, y = hx(c), hy(r)
    hline(18, x, y, color)
    add(f'<circle cx="{x}" cy="{y}" r="3" fill="{color}"/>')
    add(f'<text x="16" y="{y-5}" text-anchor="start" font-size="11" font-weight="500" fill="{color}">{label}</text>')

def ext_right(c, r, label, color):  # wire from a hole to the right edge
    x, y = hx(c), hy(r)
    xe = hx('-R') + 60
    hline(x, xe, y, color)
    add(f'<circle cx="{x}" cy="{y}" r="3" fill="{color}"/>')
    add(f'<text x="{xe+6}" y="{y+4}" text-anchor="start" font-size="11" font-weight="500" fill="{color}">{label}</text>')

GND, VBUS, V33, SIG, CAR = '#222222', '#C0392B', '#E67E22', '#2A6DB5', '#1E8449'

# VBUS row 1 and its feeds
ext_left('a', 1, 'VBUS · Pico pin 40', VBUS)
resistor('b', 1, 'b', 5, '10k')          # TXp pull-up
jumper('d', 1, 'd', 16, VBUS)            # VBUS to row 16
resistor('b', 16, 'b', 19, '10k')        # PWp pull-up
# TXp divider
ext_left('a', 5, 'TXp — harness pin 1, panel wire', CAR)
resistor('c', 5, 'c', 8, '10k')
resistor('d', 8, 'd', 11, '15k')
jumper('a', 11, '-L', 11, GND)
jumper('e', 8, 'f', 8, SIG)
ext_right('j', 8, 'GP5 · pin 7', SIG)
# Q1 TX driver rows 12-14
fet('b', 12, 13, 14, 'Q1')
jumper('a', 12, '-L', 12, GND)
resistor('e', 13, 'f', 13, '1k')
ext_right('j', 13, 'GP4 · pin 6', SIG)
ext_left('a', 14, 'TXh — harness pin 1, head-unit wire', CAR)
# PWp + Q5 buffer rows 19-26
ext_left('a', 19, 'PWp — harness pin 3, panel wire', CAR)
resistor('c', 19, 'c', 22, '10k')
fet('b', 21, 22, 23, 'Q5')
jumper('a', 21, '-L', 21, GND)
resistor('d', 23, 'd', 26, '10k')
jumper('e', 23, 'f', 23, SIG)
ext_right('j', 23, 'GP2 · pin 4', SIG)
ext_left('a', 26, '3V3 · Pico pin 36', V33)
# Q2 PWR driver rows 27-29
fet('b', 27, 28, 29, 'Q2')
jumper('a', 27, '-L', 27, GND)
resistor('e', 28, 'f', 28, '1k')
ext_right('j', 28, 'GP3 · pin 5', SIG)
ext_left('a', 29, 'PWh — harness pin 3, head-unit wire', CAR)
# RX divider, right half rows 3-9
ext_right('j', 3, 'RX — harness pin 2, both wires joined', CAR)
resistor('i', 3, 'i', 6, '10k')
resistor('h', 6, 'h', 9, '15k')
jumper('j', 9, '-R', 9, GND)
ext_right('f', 6, 'GP13 · pin 17', SIG)
# CONT divider, right half rows 15-21
ext_right('j', 15, 'CONT — harness pin 12, both wires joined', CAR)
resistor('i', 15, 'i', 18, '68k')
resistor('h', 18, 'h', 21, '15k')
zener('g', 18, 21, 'Z1 ▲')
jumper('j', 21, '-R', 21, GND)
ext_right('f', 18, 'GP26 · pin 31', SIG)
# grounds: harness GND and Pico GND into the left rail, rails joined
ext_left('-L', 2, 'GND — harness pin 9', GND)
ext_left('-L', 24, 'GND — Pico pin 38', GND)
jumper('-L', 30, '-R', 30, GND)

W = hx('-R') + 60 + 250
H = hy(NROWS) + 50
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Helvetica, Arial, sans-serif">'
       '<title>Provisional OPERA MITM — half-size breadboard, hole by hole</title>'
       f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>'
       '<text x="18" y="24" font-size="14" font-weight="500" fill="#222">Provisional OPERA MITM — half-size breadboard, hole by hole. Left "−" rail = GND (both "−" rails joined). "+" rails unused.</text>'
       + ''.join(out) + '</svg>')
open(sys.argv[1], 'w').write(svg)
print(W, H, len(svg))
