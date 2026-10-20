"""Best-effort media length in seconds from the raw file bytes. No ffmpeg. Returns None when unknown."""

import struct

MAX_SECONDS = 24 * 3600
_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]


def _boxes(buf, start, end):
    pos = start
    while pos + 8 <= end:
        size, typ = struct.unpack(">I4s", buf[pos:pos + 8])
        header = 8
        if size == 1:
            if pos + 16 > end:
                return
            size = struct.unpack(">Q", buf[pos + 8:pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header:
            return
        yield typ, pos + header, min(pos + size, end)
        pos += size


def _mp4_seconds(data):
    for typ, s, e in _boxes(data, 0, len(data)):
        if typ != b"moov":
            continue
        for typ2, s2, e2 in _boxes(data, s, e):
            if typ2 != b"mvhd" or e2 - s2 < 20:
                continue
            if data[s2] == 1 and e2 - s2 >= 32:
                timescale, duration = struct.unpack(">IQ", data[s2 + 20:s2 + 32])
            else:
                timescale, duration = struct.unpack(">II", data[s2 + 12:s2 + 20])
            return duration / timescale if timescale else None
    return None


def _mp3_seconds(data):
    pos = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        pos = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
    limit = min(len(data) - 4, pos + 65536)
    while pos < limit:
        if data[pos] == 0xFF and (data[pos + 1] & 0xE0) == 0xE0:
            version = (data[pos + 1] >> 3) & 3
            layer = (data[pos + 1] >> 1) & 3
            idx = (data[pos + 2] >> 4) & 15
            if version == 3 and layer == 1 and 0 < idx < 15:
                return max(0, len(data) - pos) * 8 / (_BITRATES[idx] * 1000)
        pos += 1
    return None


def probe(data: bytes, ext: str):
    ext = (ext or "").lower()
    try:
        if ext in (".mp4", ".mov", ".m4a"):
            sec = _mp4_seconds(data)
        elif ext == ".mp3":
            sec = _mp3_seconds(data)
        else:
            return None
    except Exception:
        return None
    if sec is None or not (0 < sec <= MAX_SECONDS):
        return None
    return round(float(sec), 2)
