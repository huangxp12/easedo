"""Generate TodayTrace app icons (rounded square + white T) as PNG/ICO without PIL."""
import struct, zlib, os

BLUE = (76, 110, 245, 255)
BLUE_D = (59, 91, 219, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

def blend(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(4))

def make_pixels(size):
    px = []
    r = size * 0.22
    for y in range(size):
        row = []
        for x in range(size):
            # rounded-rect coverage (supersampled by center distance)
            fx, fy = x + 0.5, y + 0.5
            cx = min(max(fx, r), size - r)
            cy = min(max(fy, r), size - r)
            d = ((fx - cx) ** 2 + (fy - cy) ** 2) ** 0.5
            if d > r + 0.5:
                row.append(CLEAR)
                continue
            # vertical gradient on the square
            t = y / size
            col = blend(BLUE, BLUE_D, t)
            # white "T": horizontal bar + vertical bar
            in_bar_h = (0.22 * size <= fx <= 0.78 * size) and (0.26 * size <= fy <= 0.37 * size)
            in_bar_v = (0.445 * size <= fx <= 0.555 * size) and (0.37 * size <= fy <= 0.75 * size)
            if in_bar_h or in_bar_v:
                col = WHITE
            row.append(col)
        px.append(row)
    return px

def make_png(size):
    px = make_pixels(size)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for row in px:
        raw += b'\x00' + b''.join(struct.pack('4B', *p) for p in row)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

def make_ico(sizes=(32, 48, 256)):
    imgs = [(s, make_png(s)) for s in sizes]
    header = struct.pack('<HHH', 0, 1, len(imgs))
    offset = 6 + 16 * len(imgs)
    entries = b''
    body = b''
    for s, png in imgs:
        bs = 0 if s >= 256 else s
        entries += struct.pack('<BBBBHHII', bs, bs, 0, 0, 1, 32, len(png), offset)
        body += png
        offset += len(png)
    return header + entries + body

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(out, exist_ok=True)
for name, size in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256)]:
    with open(os.path.join(out, name), 'wb') as f:
        f.write(make_png(size))
with open(os.path.join(out, 'icon.ico'), 'wb') as f:
    f.write(make_ico())
print('icons written to', out)
