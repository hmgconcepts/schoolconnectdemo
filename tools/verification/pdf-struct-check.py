#!/usr/bin/env python3
"""
V12.63 PDF structure gate.

PyMuPDF renders almost anything: it reconstructs glyph positions from the font
program itself, so it happily displayed the old broken file that CorelDRAW could
not read. This checks the PDF *as an object graph*, the way a strict consumer
does. Exit code is non-zero on any failure, so it can be used as a release gate.

Usage:  python3 pdf-struct-check.py FILE.pdf [--expect-images N]
"""
import sys, re, struct, zlib

FAIL = []
def check(cond, msg):
    if cond: print('  ok   ' + msg)
    else:
        print('  FAIL ' + msg); FAIL.append(msg)

def objects(data):
    out = {}
    for m in re.finditer(rb'(\d+)\s+0\s+obj(.*?)endobj', data, re.S):
        out[int(m.group(1))] = m.group(2)
    return out

def stream_of(body):
    i = body.find(b'stream')
    if i < 0: return None
    j = body.rfind(b'endstream')
    raw = body[i+6:j]
    if raw.startswith(b'\r\n'): raw = raw[2:]
    elif raw.startswith(b'\n'): raw = raw[1:]
    return raw[:-1] if raw.endswith(b'\n') else raw

def tt_tables(ttf):
    n = struct.unpack('>H', ttf[4:6])[0]
    t = {}
    for k in range(n):
        off = 12 + k*16
        tag = ttf[off:off+4].decode('latin-1', 'replace')
        t[tag] = struct.unpack('>II', ttf[off+8:off+16])
    return t

def tt_hmtx_widths(ttf):
    """Authoritative per-WinAnsi-code advance widths, straight from the font.
    Uses fontTools so this harness cannot disagree with the writer by accident
    (a hand-rolled cmap-format-4 parser got the segment offsets wrong, which
    produced 21 phantom mismatches on a PDF that was in fact correct)."""
    import io as _io, math
    from fontTools.ttLib import TTFont
    f = TTFont(_io.BytesIO(bytes(ttf)), fontNumber=0, lazy=True)
    upem = f['head'].unitsPerEm
    cmap = f.getBestCmap()
    hm = f['hmtx']; nhm = f['hhea'].numberOfHMetrics
    CP = {0x80:0x20AC,0x82:0x201A,0x83:0x0192,0x84:0x201E,0x85:0x2026,0x86:0x2020,
          0x87:0x2021,0x88:0x02C6,0x89:0x2030,0x8A:0x0160,0x8B:0x2039,0x8C:0x0152,
          0x8E:0x017D,0x91:0x2018,0x92:0x2019,0x93:0x201C,0x94:0x201D,0x95:0x2022,
          0x96:0x2013,0x97:0x2014,0x98:0x02DC,0x99:0x2122,0x9A:0x0161,0x9B:0x203A,
          0x9C:0x0153,0x9E:0x017E,0x9F:0x0178}
    width = {}
    for code in range(256):
        u = CP.get(code, code)
        g = cmap.get(u)
        if g is None:
            width[code] = None; continue
        aw = hm[g][0]
        # NB: Python's round() is banker's rounding; the writer uses JS
        # Math.round (half away from zero). 562.5 must become 563, not 562.
        width[code] = math.floor(aw * 1000 / upem + 0.5)
    return width, upem

def main(path, expect_images=None):
    data = open(path, 'rb').read()
    objs = objects(data)
    print('\n== %s ==' % path)
    print('  %d bytes, %d objects' % (len(data), len(objs)))

    check(data.startswith(b'%PDF-1.'), 'header is a classic PDF')
    check(b'%%EOF' in data[-1024:], 'trailer ends with %%EOF')
    m = re.search(rb'startxref\s+(\d+)', data[-2048:])
    check(m is not None, 'startxref present')
    if m:
        off = int(m.group(1))
        check(data[off:off+4] == b'xref', 'startxref points at the xref table')

    # ---- fonts -------------------------------------------------------------
    fonts = []
    for n, body in objs.items():
        if b'/Type /Font' in body and b'/Subtype /TrueType' in body:
            fonts.append((n, body))
    check(len(fonts) > 0, 'at least one /TrueType font (%d found)' % len(fonts))

    for n, body in fonts:
        base = re.search(rb'/BaseFont\s*/(\S+)', body)
        name = base.group(1).decode() if base else '?'
        first = re.search(rb'/FirstChar\s+(\d+)', body)
        last = re.search(rb'/LastChar\s+(\d+)', body)
        check(first is not None and last is not None,
              '%s declares /FirstChar and /LastChar' % name)
        wm = re.search(rb'/Widths\s*\[([^\]]*)\]', body)
        if not wm:
            check(False, '%s has a /Widths array' % name)
            continue
        vals = [int(x) for x in wm.group(1).split()]
        if first and last:
            want = int(last.group(1)) - int(first.group(1)) + 1
            check(len(vals) == want,
                  '%s /Widths length %d == LastChar-FirstChar+1 (%d)' % (name, len(vals), want))
        nonzero = sum(1 for v in vals if v > 0)
        check(nonzero > 0, '%s /Widths has real values (%d/%d non-zero)' % (name, nonzero, len(vals)))

        tu = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', body)
        check(tu is not None, '%s references a /ToUnicode CMap' % name)
        if tu:
            cm = objs.get(int(tu.group(1)), b'')
            s = stream_of(cm) or b''
            check(b'begincmap' in s and b'endcmap' in s,
                  '%s /ToUnicode is a well-formed CMap' % name)

        fd = re.search(rb'/FontDescriptor\s+(\d+)\s+0\s+R', body)
        check(fd is not None, '%s references a /FontDescriptor' % name)
        ff = None
        if fd:
            d = objs.get(int(fd.group(1)), b'')
            for key in (b'/FontBBox', b'/Ascent', b'/Descent', b'/CapHeight', b'/Flags'):
                check(key in d, '%s descriptor has %s' % (name, key.decode()))
            fm = re.search(rb'/FontFile2\s+(\d+)\s+0\s+R', d)
            check(fm is not None, '%s descriptor embeds a /FontFile2' % name)
            if fm:
                ff = objs.get(int(fm.group(1)))
        if not ff:
            continue
        ttf = stream_of(ff)
        check(ttf is not None and ttf[:4] == b'\x00\x01\x00\x00',
              '%s /FontFile2 is a raw TrueType program' % name)
        lm = re.search(rb'/Length1\s+(\d+)', ff)
        check(lm is not None and int(lm.group(1)) == len(ttf or b''),
              '%s /Length1 matches the real font length' % name)
        if not ttf: continue
        try:
            tabs = tt_tables(ttf)
        except Exception as e:
            check(False, '%s font table directory readable (%s)' % (name, e)); continue
        bad = [t for t, (o, ln) in tabs.items() if o + ln > len(ttf)]
        check(not bad, '%s font tables all inside the file' % name)

        # THE decisive check: every declared width must equal the font's own
        real, upem = tt_hmtx_widths(ttf)
        if first:
            fc = int(first.group(1))
            mism = 0; tested = 0
            for i, v in enumerate(vals):
                code = fc + i
                truth = real.get(code)
                if truth is None:
                    if v != 0: mism += 1
                else:
                    tested += 1
                    if v != truth: mism += 1
            check(mism == 0,
                  '%s /Widths matches hmtx exactly (%d checked, %d mismatches)' % (name, tested, mism))

    # ---- content streams ---------------------------------------------------
    tc = zlib.crc32
    bad_tj = 0; total_tj = 0; codes = set(); allowed = set()
    for name_body in fonts:
        pass
    # collect the codes each font can draw
    for n, body in fonts:
        fd = re.search(rb'/FontDescriptor\s+(\d+)\s+0\s+R', body)
        if not fd: continue
        d = objs.get(int(fd.group(1)), b'')
        fm = re.search(rb'/FontFile2\s+(\d+)\s+0\s+R', d)
        if not fm: continue
        ttf = stream_of(objs.get(int(fm.group(1)), b''))
        real, _ = tt_hmtx_widths(ttf)
        for c, v in real.items():
            if v is not None: allowed.add(c)
        allowed.add(32)

    for n, body in objs.items():
        if b'BT' not in body: continue
        s = stream_of(body) or b''
        for m2 in re.finditer(rb'\((.*?)\)\s*Tj', s, re.S):
            total_tj += 1
            raw = re.sub(rb'\\([()\\])', rb'\1', m2.group(1))
            for b in raw:
                codes.add(b)
                if b not in allowed and b not in (0x20,):
                    bad_tj += 1
    if total_tj:
        check(bad_tj == 0,
              'every Tj string uses only codes the font can draw (%d strings, %d bad codes)'
              % (total_tj, bad_tj))

    # ---- images ------------------------------------------------------------
    imgs = []
    for n, body in objs.items():
        if b'/Subtype /Image' in body:
            w = re.search(rb'/Width\s+(\d+)', body); h = re.search(rb'/Height\s+(\d+)', body)
            filt = re.search(rb'/Filter\s*/(\w+)', body)
            imgs.append((n, int(w.group(1)) if w else 0, int(h.group(1)) if h else 0,
                         filt.group(1).decode() if filt else '?'))
    print('  images: %s' % (imgs or 'none'))
    check(all(i[1] > 0 and i[2] > 0 for i in imgs), 'every image has real dimensions')
    check(all(i[3] in ('DCTDecode', 'FlateDecode') for i in imgs),
          'every image uses a filter every consumer understands')
    if expect_images is not None:
        check(len(imgs) == expect_images,
              'image count %d == expected %d' % (len(imgs), expect_images))

    # ---- overall -----------------------------------------------------------
    print('\n  RESULT: %s (%d failure%s)' % ('PASS' if not FAIL else 'FAIL', len(FAIL), '' if len(FAIL)==1 else 's'))
    return 1 if FAIL else 0

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    n = None
    for a in sys.argv[1:]:
        if a.startswith('--expect-images'):
            n = int(a.split('=')[1])
    sys.exit(main(args[0], n))
