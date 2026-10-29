# -*- coding: utf-8 -*-
"""
Sao chép + tối ưu tài nguyên giao diện từ các thư mục nguồn vào assets/ui/ (chạy MỘT LẦN ở bước chuẩn bị).
Ảnh nguồn KHÔNG bị sửa. Bản bàn giao chỉ dùng assets/ui/ (đường dẫn tương đối), không cần thư mục nguồn.
Logo chính và hai ảnh bí ngô (assets/main-logo.jpg, pumpkin-*.png) KHÔNG được công cụ này đụng tới.

Cách dùng (từ thư mục halloween-quiz):  py tools/prepare_ui_assets.py
Yêu cầu: Python 3 + Pillow.
"""
import os
import sys

from PIL import Image, ImageEnhance

GAME_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.dirname(GAME_DIR)
OUT_DIR = os.path.join(GAME_DIR, "assets", "ui")

HW = os.path.join(SRC_DIR, "halloween", "public", "images")
ALTP = os.path.join(SRC_DIR, "AiLaTrieuPhu", "app", "src", "main", "res")
GI = os.path.join(SRC_DIR, "genshin-impact-wish-simulator", "src", "assets", "images", "ui")

# (nguồn, tên ra, cạnh dài tối đa)
JOBS = [
    (os.path.join(HW, "home-tree1.png"), "tree-left.webp", 620),
    (os.path.join(HW, "home-tree2.png"), "tree-right.webp", 620),
    (os.path.join(HW, "nav-bat.png"), "bat.webp", 260),
    (os.path.join(HW, "stars.png"), "sparkle.webp", 128),
    (os.path.join(HW, "item-pumpkin.png"), "jack.webp", 300),
    (os.path.join(HW, "category-ghost.png"), "ghost.webp", 300),
    (os.path.join(HW, "home-pumpkin.png"), "pumpkin-flame.webp", 480),
    (os.path.join(HW, "party-cauldron.png"), "cauldron.webp", 420),
    (os.path.join(ALTP, "drawable-xxxhdpi", "bg_circle_anim.png"), "rays.webp", 480),
]


def save_webp(src, name, max_side):
    img = Image.open(src).convert("RGBA")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    dst = os.path.join(OUT_DIR, name)
    img.save(dst, "WEBP", quality=86, method=6)
    print("Đã tạo", name, img.size, os.path.getsize(dst) // 1024, "KB")


def night_backdrop():
    # Nền triệu hồi: ảnh đêm trăng tàn tích, làm tối nhẹ để chữ và vòng quay nổi bật.
    img = Image.open(os.path.join(GI, "wish-details-background.jpg")).convert("RGB")
    img = img.resize((1600, 900), Image.LANCZOS)
    img = ImageEnhance.Brightness(img).enhance(0.92)
    dst = os.path.join(OUT_DIR, "night-ruins.jpg")
    img.save(dst, "JPEG", quality=80, optimize=True, progressive=True)
    print("Đã tạo night-ruins.jpg", img.size, os.path.getsize(dst) // 1024, "KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT_DIR, exist_ok=True)
    for src, name, side in JOBS:
        save_webp(src, name, side)
    night_backdrop()
