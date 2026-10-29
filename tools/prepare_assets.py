# -*- coding: utf-8 -*-
"""
Tách nền trắng của hai ảnh bí ngô gốc thành PNG trong suốt (chạy MỘT LẦN ở bước chuẩn bị).
Ảnh gốc (nằm ở thư mục cha của halloween-quiz) KHÔNG bị sửa; kết quả ghi vào assets/.
Đã chạy xong; bản bàn giao chỉ dùng ảnh trong assets/ và không cần chạy lại.

Cách dùng (từ thư mục halloween-quiz):  py tools/prepare_assets.py
Yêu cầu: Python 3 + Pillow.
"""
import os
from collections import deque

from PIL import Image, ImageFilter

GAME_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.dirname(GAME_DIR)
JOBS = [
    ("870174733_988927846947751_5297437707463387241_n.jpg", "pumpkin-glasses.png"),
    ("872486635_1162937326160949_5029067737339536063_n.jpg", "pumpkin-clown.png"),
]
WHITE_MIN = 225  # điểm ảnh có min(R,G,B) >= ngưỡng và nối với mép ảnh = nền


def remove_background(src, dst, max_side=520):
    img = Image.open(src).convert("RGB")
    w, h = img.size
    px = img.load()
    bg = bytearray(w * h)
    queue = deque()
    for x in range(w):
        queue.append((x, 0)); queue.append((x, h - 1))
    for y in range(h):
        queue.append((0, y)); queue.append((w - 1, y))
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if bg[i] or min(px[x, y]) < WHITE_MIN:
            continue
        bg[i] = 1
        if x > 0: queue.append((x - 1, y))
        if x < w - 1: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y < h - 1: queue.append((x, y + 1))

    mask = Image.new("L", (w, h))
    mask.putdata([0 if b else 255 for b in bg])
    # thu mép 1px rồi làm mềm để không còn viền trắng trên nền tối
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert("RGBA")
    out.putalpha(mask)
    bbox = mask.point(lambda a: 255 if a > 8 else 0).getbbox()
    out = out.crop(bbox)
    out.thumbnail((max_side, max_side), Image.LANCZOS)
    out.save(dst, optimize=True)
    print("Đã tạo", dst, out.size)


if __name__ == "__main__":
    for name, out_name in JOBS:
        remove_background(os.path.join(SRC_DIR, name), os.path.join(GAME_DIR, "assets", out_name))
