"""Deterministic, dependency-free PNGs with a supersampled W glyph."""
import argparse
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'web/public'
POINTS = [(132,148),(176,148),(205,296),(238,184),(274,184),(307,296),(336,148),(380,148),(328,364),(288,364),(256,260),(224,364),(184,364)]


def png(size):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    width = size * 4
    points = [(x*width/512, y*width/512) for x,y in POINTS]
    mask = bytearray(width*width)
    for row in range(width):
        y = row + 0.5
        crossings = sorted(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])
                           for a,b in zip(points,points[1:]+points[:1],strict=True) if (a[1]>y)!=(b[1]>y))
        for index in range(0,len(crossings),2):
            left,right = (math.ceil(value-0.5) for value in crossings[index:index+2])
            mask[row*width+left:row*width+right] = b'\x01' * (right-left)
    rows = bytearray()
    background, foreground = (20,24,25), (224,229,220)
    for y in range(size):
        rows.append(0)
        for x in range(size):
            coverage = sum(sum(mask[(y*4+dy)*width+x*4:(y*4+dy)*width+x*4+4]) for dy in range(4)) / 16
            rows.extend(round(a+(b-a)*coverage) for a,b in zip(background,foreground,strict=True))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('!IIBBBBB',size,size,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress(rows,9)) + chunk(b'IEND',b'')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    for size in (192,512):
        path, data = ROOT / f'icon-{size}.png', png(size)
        if args.check:
            if path.read_bytes() != data:
                raise SystemExit('Icon regeneration required')
        else:
            ROOT.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
