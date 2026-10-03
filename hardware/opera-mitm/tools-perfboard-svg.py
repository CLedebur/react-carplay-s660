#!/usr/bin/env python3
"""Pad-accurate build drawings for the OPERA MITM perfboards.

  python3 tools-perfboard-svg.py main        > main-board.svg       (7 x 9 cm, cols A-Z, rows 1-34)
  python3 tools-perfboard-svg.py mezz        > pico-mezzanine.svg   (7 x 3 cm, cols 1-27, rows A-K)
  python3 tools-perfboard-svg.py main-table  > markdown wire/bridge tables for the main board
  python3 tools-perfboard-svg.py mezz-table

Drawings show parts, solder bridges (grey bars) and WIRE ENDPOINTS as numbered tags; the same
numbers are in the tables. A wire is one insulated jumper soldered between its two tagged pads
(either side of the board). Bus wires are bare, on the solder side.
"""
import sys, string

P = 22
GND, VBUS, V33, SIG, CAR, LINK = '#222222', '#C0392B', '#E67E22', '#2A6DB5', '#1E8449', '#8E44AD'
KIND = {GND: 'GND', VBUS: 'VBUS', V33: '3V3', SIG: 'signal', CAR: 'car wire', LINK: 'TEMP link'}

class Board:
    def __init__(self, cols, rows, title, x0=130, y0=120):
        self.cl, self.rl, self.title = cols, rows, title
        self.x0, self.y0 = x0, y0
        self.out, self.wires, self.bridges = [], [], []
        self.tagcount = {}
    def cx(self, c): return self.x0 + self.cl.index(c) * P
    def cy(self, r): return self.y0 + self.rl.index(r) * P
    def pad(self, c, r): return self.cx(c), self.cy(r)
    def add(self, s): self.out.append(s)

    def grid(self, top_letters=True):
        w, h = (len(self.cl) - 1) * P + 44, (len(self.rl) - 1) * P + 44
        self.add(f'<rect x="{self.x0-22}" y="{self.y0-22}" width="{w}" height="{h}" rx="6" fill="#DDE8D5" stroke="#9AAA90" stroke-width="1"/>')
        for c in self.cl:
            for r in self.rl:
                x, y = self.pad(c, r)
                self.add(f'<circle cx="{x}" cy="{y}" r="5.5" fill="#E9CD8A" stroke="#A88A3C" stroke-width="0.6"/><circle cx="{x}" cy="{y}" r="2" fill="#DDE8D5"/>')
        for c in self.cl:
            ys = [self.cy(self.rl[-1]) + 40] + ([self.y0 - 32] if top_letters else [])
            for y in ys:
                self.add(f'<text x="{self.cx(c)}" y="{y}" text-anchor="middle" font-size="11" fill="#333">{c}</text>')
        for r in self.rl:
            for x, a in ((self.x0 - 34, 'end'), (self.cx(self.cl[-1]) + 34, 'start')):
                self.add(f'<text x="{x}" y="{self.cy(r)+4}" text-anchor="{a}" font-size="11" fill="#333">{r}</text>')

    # ---- parts -------------------------------------------------------------------------
    def resistor(self, c1, r1, c2, r2, label):
        x1, y1 = self.pad(c1, r1); x2, y2 = self.pad(c2, r2)
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#444" stroke-width="1.4"/>')
        mx, my = (x1+x2)/2, (y1+y2)/2
        if x1 == x2:
            self.add(f'<rect x="{mx-6}" y="{my-14}" width="12" height="28" rx="3" fill="#F1E2B6" stroke="#8A7A50" stroke-width="0.9"/>')
            self.add(f'<text x="{mx+10}" y="{my+4}" text-anchor="start" font-size="10" font-weight="500" fill="#111">{label}</text>')
        else:
            self.add(f'<rect x="{mx-14}" y="{my-6}" width="28" height="12" rx="3" fill="#F1E2B6" stroke="#8A7A50" stroke-width="0.9"/>')
            self.add(f'<text x="{mx}" y="{my-9}" text-anchor="middle" font-size="10" font-weight="500" fill="#111">{label}</text>')
        for x, y in ((x1, y1), (x2, y2)): self.add(f'<circle cx="{x}" cy="{y}" r="3" fill="#444"/>')

    def diode(self, c, r_anode, r_cathode, label, fill='#EFE6FA', stroke='#7A4DB5'):
        x = self.cx(c); ya, yk = self.cy(r_anode), self.cy(r_cathode)
        self.add(f'<line x1="{x}" y1="{ya}" x2="{x}" y2="{yk}" stroke="#444" stroke-width="1.4"/>')
        my = (ya+yk)/2
        self.add(f'<rect x="{x-6}" y="{my-14}" width="12" height="28" rx="3" fill="{fill}" stroke="{stroke}" stroke-width="0.9"/>')
        by = my + (10 if yk > ya else -10)
        self.add(f'<line x1="{x-6}" y1="{by}" x2="{x+6}" y2="{by}" stroke="#111" stroke-width="3"/>')
        self.add(f'<text x="{x+10}" y="{my+4}" text-anchor="start" font-size="10" font-weight="500" fill="#111">{label}</text>')
        for y in (ya, yk): self.add(f'<circle cx="{x}" cy="{y}" r="3" fill="#444"/>')

    def fet(self, cs, cg, cd, r, name):
        xs, xd, y = self.cx(cs), self.cx(cd), self.cy(r)
        self.add(f'<rect x="{min(xs,xd)-9}" y="{y-10}" width="{abs(xd-xs)+18}" height="20" rx="6" fill="#DFF5F1" stroke="#1F8A78" stroke-width="0.9"/>')
        for c, l in ((cs, 'S'), (cg, 'G'), (cd, 'D')):
            x = self.cx(c)
            self.add(f'<circle cx="{x}" cy="{y}" r="3" fill="#1F8A78"/><text x="{x}" y="{y-13}" text-anchor="middle" font-size="9" font-weight="500" fill="#0B4A40">{l}</text>')
        self.add(f'<text x="{(xs+xd)/2}" y="{y+22}" text-anchor="middle" font-size="10" font-weight="500" fill="#0B4A40">{name}</text>')

    def relay(self, c_coil, r_top, r_bot, name):
        i0 = self.cl.index(c_coil)
        cols = [self.cl[i0+o] for o in (0, 3, 5, 7)]
        x1, x2 = self.cx(cols[0]) - 16, self.cx(cols[-1]) + 16
        y1, y2 = self.cy(r_top) - 18, self.cy(r_bot) + 18
        self.add(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" rx="4" fill="#F6F0FC" fill-opacity="0.6" stroke="#7A4DB5" stroke-width="1.2" stroke-dasharray="5 3"/>')
        top = ['coil', 'COM', 'NC', 'NO']; bot = ['coil', 'COM', 'NC', 'NO']
        for c, nt, nb in zip(cols, top, bot):
            for r, n in ((r_top, nt + ' A'), (r_bot, nb + ' B')):
                x, y = self.pad(c, r)
                self.add(f'<circle cx="{x}" cy="{y}" r="4.5" fill="#C9B3EA" stroke="#7A4DB5" stroke-width="0.9"/>')
                self.add(f'<text x="{x}" y="{y + (-9 if r == r_top else 16)}" text-anchor="middle" font-size="8" fill="#4A2A80">{n if "coil" not in n else "coil"}</text>')
        self.add(f'<text x="{(x1+x2)/2}" y="{(y1+y2)/2+4}" text-anchor="middle" font-size="11" font-weight="500" fill="#4A2A80">{name}</text>')

    def socket(self, c1, c2, r, label, pins=None):
        x1, x2, y = self.cx(c1), self.cx(c2), self.cy(r)
        self.add(f'<rect x="{x1-10}" y="{y-9}" width="{x2-x1+20}" height="18" rx="2" fill="#3A3A3A" stroke="#111" stroke-width="0.8"/>')
        cols = self.cl[self.cl.index(c1):self.cl.index(c2)+1]
        for i, c in enumerate(cols):
            x = self.cx(c); self.add(f'<rect x="{x-3}" y="{y-3}" width="6" height="6" fill="#0A0A0A"/>')
            if pins:
                dy = 20 if i % 2 == 0 else 32
                self.add(f'<text x="{x}" y="{y+dy}" text-anchor="middle" font-size="9" font-weight="500" fill="#111">{pins[i]}</text>')
        if label: self.add(f'<text x="{x2+16}" y="{y+4}" text-anchor="start" font-size="10" fill="#111">{label}</text>')

    def terminal(self, c1, r, labels, sub):
        i0 = self.cl.index(c1); n = len(labels)
        x1 = self.cx(c1) - 13; x2 = self.cx(self.cl[i0 + 2*(n-1)]) + 13; y = self.cy(r)
        self.add(f'<rect x="{x1}" y="{y-40}" width="{x2-x1}" height="50" rx="3" fill="#4F8F55" stroke="#2B5A2F" stroke-width="0.9" opacity="0.9"/>')
        for k, (lab, s) in enumerate(zip(labels, sub)):
            c = self.cl[i0 + 2*k]; x = self.cx(c)
            self.add(f'<circle cx="{x}" cy="{y-20}" r="6.5" fill="#111" stroke="#777" stroke-width="0.6"/>')
            self.add(f'<circle cx="{x}" cy="{y}" r="3" fill="#444"/>')
            self.add(f'<text x="{x}" y="{y-50}" text-anchor="middle" font-size="10" font-weight="500" fill="#111">{lab}</text>')
            self.add(f'<text x="{x}" y="{y-62}" text-anchor="middle" font-size="8" fill="#555">{s}</text>')

    def bridge(self, c1, r1, c2, r2):
        self.bridges.append((c1 + r1, c2 + r2))
        x1, y1 = self.pad(c1, r1); x2, y2 = self.pad(c2, r2)
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#9A9A9A" stroke-width="8" stroke-linecap="round" opacity="0.95"/>')

    def wire(self, c1, r1, c2, r2, color, what):
        n = len(self.wires) + 1
        self.wires.append((n, c1 + r1, c2 + r2, color, what))
        for c, r in ((c1, r1), (c2, r2)):
            x, y = self.pad(c, r)
            k = self.tagcount.get(c + r, 0); self.tagcount[c + r] = k + 1
            x += 7 * k; y += 7 * k
            self.add(f'<circle cx="{x}" cy="{y}" r="8" fill="{color}" stroke="#FFFFFF" stroke-width="1.2"/>')
            self.add(f'<text x="{x}" y="{y+3.5}" text-anchor="middle" font-size="9" font-weight="500" fill="#FFFFFF">{n}</text>')

    def bus(self, c1, c2, r, color, label):
        x1, x2, y = self.cx(c1), self.cx(c2), self.cy(r)
        self.add(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="4" opacity="0.75"/>')
        self.add(f'<text x="{x2+52}" y="{y+4}" text-anchor="start" font-size="10" font-weight="500" fill="{color}">{label}</text>')

    def zone(self, c1, r1, c2, r2, label, color, label_at=None):
        x1, y1 = self.pad(c1, r1); x2, y2 = self.pad(c2, r2)
        self.add(f'<rect x="{x1-13}" y="{y1-13}" width="{x2-x1+26}" height="{y2-y1+26}" rx="6" fill="none" stroke="{color}" stroke-width="1" stroke-dasharray="3 3"/>')
        if label_at: lx, ly = self.pad(*label_at); ly += 4
        else: lx, ly = x1 - 9, y1 - 16
        self.add(f'<text x="{lx}" y="{ly}" text-anchor="start" font-size="10" font-weight="500" fill="{color}">{label}</text>')

    def text(self, x, y, s, size=10, color='#111', anchor='start', weight=400):
        self.add(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{color}">{s}</text>')

    def legend(self, x, y):
        items = [(CAR, 'car wire from a terminal'), (SIG, 'signal'), (GND, 'GND'), (VBUS, 'VBUS 5 V'), (V33, '3V3'), (LINK, 'temporary link (until the relays)')]
        for i, (col, lab) in enumerate(items):
            yy = y + i * 16
            self.add(f'<circle cx="{x}" cy="{yy}" r="7" fill="{col}"/><text x="{x+12}" y="{yy+4}" font-size="10" fill="#111">{lab}</text>')
        yy = y + len(items) * 16
        self.add(f'<line x1="{x-6}" y1="{yy}" x2="{x+6}" y2="{yy}" stroke="#9A9A9A" stroke-width="8" stroke-linecap="round"/><text x="{x+12}" y="{yy+4}" font-size="10" fill="#111">solder bridge between neighbouring pads</text>')
        self.text(x - 8, yy + 20, 'Numbered tags: the two ends of one wire (see table).', 10)

    def svg(self, extra_right=0):
        W = self.cx(self.cl[-1]) + 60 + extra_right
        H = self.cy(self.rl[-1]) + 64
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Helvetica, Arial, sans-serif">'
                f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>'
                f'<text x="16" y="24" font-size="14" font-weight="500" fill="#111">{self.title}</text>'
                + ''.join(self.out) + '</svg>')

    def tables(self):
        s = ['| # | From | To | Kind | What |', '|---|---|---|---|---|']
        for n, a, b, col, what in self.wires:
            s.append(f'| {n} | {a} | {b} | {KIND[col]} | {what} |')
        s.append('')
        s.append('Solder bridges (flow solder across the two neighbouring pads): ' + ', '.join(f'{a}–{b}' for a, b in self.bridges))
        return '\n'.join(s)


def main_board():
    cols = list(string.ascii_uppercase)
    rows = [str(i) for i in range(1, 35)]
    b = Board(cols, rows, 'OPERA MITM — main board, 7 × 9 cm perfboard, seen from the component side (column letters along the bottom)')
    b.grid(top_letters=False)
    b.terminal('B', '2', ['TXp', 'TXh', 'RX', 'PWp', 'PWh', 'CONT', 'GND'], ['pin 1 panel', 'pin 1 HU', 'pin 2', 'pin 3 panel', 'pin 3 HU', 'pin 12', 'pin 9'])
    b.terminal('P', '2', ['RUN', 'GND'], ['J1 pin 3', 'J1 pin 2'])
    b.bus('A', 'Z', '14', GND, 'GND bus · bare wire, solder side')
    b.bus('A', 'Z', '23', VBUS, 'VBUS bus · bare wire, solder side')

    # input lanes
    b.bridge('B', '2', 'B', '3'); b.resistor('B', '3', 'B', '7', '10k'); b.bridge('B', '7', 'B', '8'); b.resistor('B', '8', 'B', '12', '15k'); b.bridge('B', '8', 'C', '8')
    b.bridge('F', '2', 'F', '3'); b.resistor('F', '3', 'F', '7', '10k'); b.bridge('F', '7', 'F', '8'); b.resistor('F', '8', 'F', '12', '15k'); b.bridge('F', '8', 'G', '8')
    b.bridge('H', '2', 'H', '3'); b.resistor('H', '3', 'H', '8', '10k'); b.bridge('H', '8', 'H', '9')
    b.fet('G', 'H', 'I', '10', 'Q5 buffer')            # row 10 to keep G9 clear of G8
    b.bridge('H', '9', 'H', '10')
    b.bridge('I', '10', 'I', '11'); b.resistor('I', '11', 'I', '13', '10k'); b.bridge('I', '10', 'J', '10')
    b.bridge('L', '2', 'L', '3'); b.resistor('L', '3', 'L', '7', '68k'); b.bridge('L', '7', 'L', '8'); b.resistor('L', '8', 'L', '12', '15k')
    b.diode('M', '12', '8', 'Z1 3.6 V'); b.bridge('L', '8', 'M', '8'); b.bridge('L', '12', 'M', '12'); b.bridge('M', '8', 'N', '8')

    # drivers
    b.zone('P', '4', 'Z', '13', 'drivers', '#1F8A78', label_at=('Y', '9'))
    b.fet('Q', 'R', 'S', '5', 'Q1 TX'); b.bridge('R', '5', 'R', '6'); b.resistor('R', '6', 'R', '9', '1k')
    b.fet('V', 'W', 'X', '5', 'Q2 PWR'); b.bridge('W', '5', 'W', '6'); b.resistor('W', '6', 'W', '9', '1k')
    b.fet('Q', 'R', 'S', '12', 'Q3 relays'); b.bridge('R', '12', 'R', '13'); b.resistor('R', '13', 'O', '13', '1k')
    b.fet('V', 'W', 'X', '12', 'Q4 reset'); b.bridge('W', '12', 'W', '13'); b.resistor('W', '13', 'Z', '13', '1k')
    b.bridge('W', '12', 'W', '11'); b.resistor('W', '11', 'T', '11', '68k')

    # relays zone
    b.zone('A', '15', 'Z', '22', 'relays K1/K2 fit later', '#7A4DB5', label_at=('W', '21'))
    b.relay('B', '16', '19', 'K1 TX'); b.relay('N', '16', '19', 'K2 PWR')
    b.bridge('B', '16', 'C', '16'); b.bridge('N', '16', 'O', '16'); b.bridge('B', '19', 'C', '19'); b.bridge('N', '19', 'O', '19')
    b.diode('L', '20', '22', 'D1 1N4007', fill='#F3F3F3', stroke='#555'); b.bridge('L', '22', 'L', '23')
    b.bridge('I', '19', 'J', '19'); b.bridge('J', '19', 'J', '20'); b.resistor('J', '20', 'J', '23', '10k')
    b.bridge('U', '19', 'V', '19'); b.bridge('V', '19', 'V', '20'); b.resistor('V', '20', 'V', '23', '10k')

    # mezzanine sockets
    b.zone('A', '24', 'Z', '34', 'Pico mezzanine sits over rows 24–34 — keep this area clear', '#333', label_at=('B', '29'))
    pins = ['GND', 'VBUS', '3V3', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP13', 'GP26', 'GND']
    b.socket('F', 'Q', '24', '1×12 female header (mezzanine signals)', pins)
    b.socket('X', 'Z', '34', '', ['GND', 'nc', 'nc'])
    b.text(b.cx('W') - 6, b.cy('34') + 4, '1×3 female (mezzanine support) →', 10, anchor='end')
    b.bridge('G', '23', 'G', '24')

    # ---- wires (numbered) ----
    b.wire('A', '3', 'G', '16', CAR, 'TXp → K1 NC-A');       b.bridge('B', '3', 'A', '3')
    b.wire('A', '4', 'E', '19', CAR, 'TXp → K1 COM-B');      b.bridge('A', '3', 'A', '4')
    b.wire('D', '3', 'E', '16', CAR, 'TXh → K1 COM-A');      b.bridge('D', '2', 'D', '3')
    b.wire('G', '3', 'S', '16', CAR, 'PWp → K2 NC-A');       b.bridge('H', '3', 'G', '3')
    b.wire('G', '4', 'Q', '19', CAR, 'PWp → K2 COM-B');      b.bridge('G', '3', 'G', '4')
    b.wire('J', '3', 'Q', '16', CAR, 'PWh → K2 COM-A');      b.bridge('J', '2', 'J', '3')
    b.wire('N', '3', 'N', '14', GND, 'GND terminal → GND bus');  b.bridge('N', '2', 'N', '3')
    b.wire('R', '3', 'R', '14', GND, 'Pi GND terminal → GND bus'); b.bridge('R', '2', 'R', '3')
    b.wire('P', '3', 'X', '11', SIG, 'RUN terminal → Q4 drain'); b.bridge('P', '2', 'P', '3'); b.bridge('X', '11', 'X', '12')
    b.wire('B', '12', 'B', '14', GND, 'TX divider bottom → GND bus')
    b.wire('F', '12', 'F', '14', GND, 'RX divider bottom → GND bus')
    b.wire('G', '10', 'H', '14', GND, 'Q5 source → GND bus')
    b.wire('L', '12', 'L', '14', GND, 'CONT divider + zener → GND bus')
    b.wire('Q', '5', 'Q', '14', GND, 'Q1 source → GND bus')
    b.wire('V', '5', 'W', '14', GND, 'Q2 source → GND bus')
    b.wire('Q', '12', 'P', '14', GND, 'Q3 source → GND bus')
    b.wire('V', '12', 'V', '14', GND, 'Q4 source → GND bus')
    b.wire('T', '11', 'T', '14', GND, 'Q4 gate pull-down → GND bus')
    b.wire('S', '5', 'I', '16', SIG, 'Q1 drain → K1 NO-A')
    b.wire('X', '5', 'U', '16', SIG, 'Q2 drain → K2 NO-A')
    b.wire('S', '12', 'O', '19', SIG, 'Q3 drain → relay coil drive')
    b.wire('C', '19', 'O', '19', SIG, 'K1 coil drive = K2 coil drive')
    b.wire('C', '19', 'L', '20', SIG, 'coil drive → D1 anode')
    b.wire('C', '16', 'C', '23', VBUS, 'K1 coil → VBUS bus')
    b.wire('O', '16', 'O', '23', VBUS, 'K2 coil → VBUS bus')
    b.wire('F', '24', 'E', '14', GND, 'socket GND → GND bus')
    b.wire('Q', '24', 'O', '14', GND, 'socket GND → GND bus')
    b.wire('X', '34', 'X', '14', GND, 'support socket GND → GND bus')
    b.wire('I', '13', 'H', '24', V33, 'buffer pull-up → 3V3')
    b.wire('J', '10', 'I', '24', SIG, 'buffer out → GP2')
    b.wire('W', '9', 'J', '24', SIG, 'GP3 → Q2 gate resistor')
    b.wire('R', '9', 'K', '24', SIG, 'GP4 → Q1 gate resistor')
    b.wire('C', '8', 'L', '24', SIG, 'TX junction → GP5')
    b.wire('O', '13', 'M', '24', SIG, 'GP6 → Q3 gate resistor')
    b.wire('Z', '13', 'N', '24', SIG, 'GP7 → Q4 gate resistor')
    b.wire('G', '8', 'O', '24', SIG, 'RX junction → GP13')
    b.wire('N', '8', 'P', '24', SIG, 'CONT junction → GP26')
    # temporary links on the relay pads
    b.wire('E', '16', 'I', '16', LINK, 'TEMP: K1 COM-A → NO-A (remove when K1 is fitted)')
    b.wire('E', '19', 'I', '19', LINK, 'TEMP: K1 COM-B → NO-B (remove when K1 is fitted)')
    b.wire('Q', '16', 'U', '16', LINK, 'TEMP: K2 COM-A → NO-A (remove when K2 is fitted)')
    b.wire('Q', '19', 'U', '19', LINK, 'TEMP: K2 COM-B → NO-B (remove when K2 is fitted)')

    b.legend(b.cx('Z') + 70, b.cy('3'))
    b.text(b.cx('Z') + 62, b.cy('11'), 'Transistors: 2N7000, flat face', 10)
    b.text(b.cx('Z') + 62, b.cy('11') + 14, 'towards the top edge → S G D', 10)
    b.text(b.cx('Z') + 62, b.cy('11') + 28, 'left to right. Verify with the', 10)
    b.text(b.cx('Z') + 62, b.cy('11') + 42, 'diode test before soldering.', 10)
    b.text(b.cx('Z') + 62, b.cy('17'), 'Relay pads: coil / COM / NC / NO', 10)
    b.text(b.cx('Z') + 62, b.cy('17') + 14, 'at columns B E G I (K1) and', 10)
    b.text(b.cx('Z') + 62, b.cy('17') + 28, 'N Q S U (K2); rows 16 and 19.', 10)
    b.text(b.cx('Z') + 62, b.cy('17') + 42, 'Both poles are interchangeable.', 10)
    return b


def mezzanine():
    cols = [str(i) for i in range(1, 28)]
    rows = list('ABCDEFGHIJK')
    b = Board(cols, rows, 'OPERA MITM — Pico mezzanine, 7 × 3 cm perfboard, component side. Pico 2 W plugs into rows B/I (pin 1 and pin 40 at column 4, USB end). Male pins point DOWN from rows A and K.')
    b.grid()
    picoB = [f'{n}' for n in range(1, 21)]
    picoI = [f'{n}' for n in range(40, 20, -1)]
    b.socket('4', '23', 'B', '', None)
    b.socket('4', '23', 'I', '', None)
    for i, c in enumerate(range(4, 24)):
        if picoB[i] in ('1', '3', '4', '5', '6', '7', '9', '10', '17', '18', '20'):
            b.text(b.cx(str(c)), b.cy('B') - 12, 'p' + picoB[i], 8, '#333', 'middle')
        if picoI[i] in ('40', '38', '36', '31', '23', '21'):
            b.text(b.cx(str(c)), b.cy('I') + 22, 'p' + picoI[i], 8, '#333', 'middle')
    hdr = ['GND', 'VBUS', '3V3', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP13', 'GP26', 'GND']
    b.socket('6', '17', 'K', '', hdr)
    b.text(b.cx('18') + 14, b.cy('K') + 4, '← 1×12 male, pins down → main row 24 F…Q', 10)
    b.socket('24', '26', 'A', '', None)
    b.text(b.cx('23') - 12, b.cy('A') + 4, '1×3 male, pins down → main row 34 X…Z  →', 10, anchor='end')
    # wires: Pico socket pad -> header pad   (row B: pin n at column n+3 ; row I: pin m at column 44-m)
    b.wire('6', 'B', '6', 'K', GND, 'Pico pin 3 GND → header GND')
    b.wire('4', 'I', '7', 'K', VBUS, 'Pico pin 40 VBUS → header VBUS')
    b.wire('8', 'I', '8', 'K', V33, 'Pico pin 36 3V3 → header 3V3')
    b.wire('7', 'B', '9', 'K', SIG, 'Pico pin 4 GP2 → header GP2')
    b.wire('8', 'B', '10', 'K', SIG, 'Pico pin 5 GP3 → header GP3')
    b.wire('9', 'B', '11', 'K', SIG, 'Pico pin 6 GP4 → header GP4')
    b.wire('10', 'B', '12', 'K', SIG, 'Pico pin 7 GP5 → header GP5')
    b.wire('12', 'B', '13', 'K', SIG, 'Pico pin 9 GP6 → header GP6')
    b.wire('13', 'B', '14', 'K', SIG, 'Pico pin 10 GP7 → header GP7')
    b.wire('20', 'B', '15', 'K', SIG, 'Pico pin 17 GP13 → header GP13')
    b.wire('13', 'I', '16', 'K', SIG, 'Pico pin 31 GP26 → header GP26')
    b.wire('6', 'I', '17', 'K', GND, 'Pico pin 38 GND → header GND')
    b.wire('24', 'A', '21', 'B', GND, 'support header pin 1 → Pico pin 18 GND')
    return b


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'main'
    if which.startswith('main'):
        b = main_board()
    else:
        b = mezzanine()
    if which.endswith('table'):
        print(b.tables())
    else:
        sys.stdout.write(b.svg(extra_right=420 if which.startswith('main') else 80))
