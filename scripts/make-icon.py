#!/usr/bin/env python3
"""Rasterise the Terminal Sessions glyph to a 128x128 marketplace icon.

No image libraries available, so shapes are drawn as signed-distance fields
(exact round caps and joins, analytic anti-aliasing) and the PNG is encoded
by hand with zlib.
"""
import math, struct, zlib, sys

N = 128           # output size
U = 24.0          # svg viewBox units
S = N / U         # units -> px

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x

def sd_round_rect(px, py, cx, cy, bx, by, r):
    qx = abs(px - cx) - bx + r
    qy = abs(py - cy) - by + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r

def sd_segment(px, py, ax, ay, bx, by):
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = clamp((pax * bax + pay * bay) / denom) if denom else 0.0
    return math.hypot(pax - bax * h, pay - bay * h)

# --- geometry, in svg units, mirroring media/terminal-sessions.svg -----------
STROKE = 1.6
HW = STROKE / 2.0
RECT = (12.0, 12.0, 9.5, 7.5, 2.0)          # cx, cy, half-w, half-h, radius
CHEVRON = [(6.5, 9.5, 9.5, 12.0), (9.5, 12.0, 6.5, 14.5)]
UNDERLINE = (12.0, 15.0, 17.5, 15.0)

BG = (0x23, 0x23, 0x23)
FRAME = (0xF2, 0xF2, 0xF2)
PROMPT = (0x4E, 0xE3, 0x9A)
BAR = (0xF2, 0xF2, 0xF2)

AA = 1.0 / S      # one output pixel, expressed in svg units

def cover(d, half):
    """Coverage of a stroke of half-width `half` at signed distance `d`."""
    return clamp((half - d) / AA + 0.5)

def over(dst, src, a):
    return tuple(int(round(s * a + d * (1.0 - a))) for d, s in zip(dst, src))

rows = []
for y in range(N):
    row = bytearray()
    for x in range(N):
        px = (x + 0.5) / S
        py = (y + 0.5) / S

        # full-bleed rounded background tile
        bg_a = cover(sd_round_rect(px, py, 12.0, 12.0, 12.0, 12.0, 4.0), 0.0)
        rgb = BG
        alpha = bg_a

        def paint(rgb, alpha, d, half, color):
            a = cover(d, half)
            if a <= 0.0:
                return rgb, alpha
            return over(rgb, color, a), max(alpha, a)

        d = abs(sd_round_rect(px, py, *RECT))
        rgb, alpha = paint(rgb, alpha, d, HW, FRAME)

        d = min(sd_segment(px, py, *s) for s in CHEVRON)
        rgb, alpha = paint(rgb, alpha, d, HW, PROMPT)

        d = sd_segment(px, py, *UNDERLINE)
        rgb, alpha = paint(rgb, alpha, d, HW, BAR)

        row += bytes((rgb[0], rgb[1], rgb[2], int(round(alpha * 255))))
    rows.append(row)

raw = b"".join(b"\x00" + bytes(r) for r in rows)

def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))

with open(sys.argv[1], "wb") as f:
    f.write(png)
print(f"wrote {sys.argv[1]} ({len(png)} bytes, {N}x{N})")
