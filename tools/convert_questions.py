# -*- coding: utf-8 -*-
"""
Chuyển file Excel câu hỏi sang js/questions-data.js (chạy MỘT LẦN ở bước chuẩn bị).

Cách dùng (từ thư mục halloween-quiz):
    py tools/convert_questions.py                       # tự tìm file .xlsx
    py tools/convert_questions.py "đường\\dẫn\\file.xlsx"

Yêu cầu: Python 3 + openpyxl (pip install openpyxl). Khi CHƠI game không cần Python.

Nguyên tắc:
- Giữ nguyên nội dung câu hỏi và đáp án (chỉ bỏ khoảng trắng thừa ở đầu/cuối ô).
- Dòng "Giải thích" trong sheet câu khó được gắn vào câu ngay phía trên,
  KHÔNG nhập thành câu hỏi riêng.
- Gặp dòng không nhận dạng được -> dừng và báo lỗi, không tự đoán.
"""
import json
import os
import sys
from datetime import datetime

try:
    import openpyxl
except ImportError:
    sys.exit("[LỖI] Thiếu thư viện openpyxl. Cài bằng: py -m pip install openpyxl")

FILE_NAME = "Bộ 50 Câu Hỏi Trắc Nghiệm_ Halloween & Tranh Biện.xlsx"
GAME_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(GAME_DIR, "js", "questions-data.js")

DIFFICULTY = {"Dễ": "easy", "Trung bình": "medium", "Khó": "hard"}
HEADER = ("STT", "Chủ đề", "Độ khó", "Câu hỏi", "Đáp án đúng", "Đáp án sai 1", "Đáp án sai 2")


def find_source():
    if len(sys.argv) > 1:
        return sys.argv[1]
    roots = [os.path.join(GAME_DIR, "data-source"), GAME_DIR, os.path.dirname(GAME_DIR)]
    for root in roots:
        for dirpath, _dirs, files in os.walk(root):
            if "node_modules" in dirpath or ".git" in dirpath:
                continue
            if FILE_NAME in files:
                return os.path.join(dirpath, FILE_NAME)
    sys.exit(
        "[LỖI] Không tìm thấy file câu hỏi.\n"
        "Hãy đặt file tại: " + os.path.join(GAME_DIR, "data-source", FILE_NAME)
    )


def clean(value):
    return value.strip() if isinstance(value, str) else value


def main():
    src = find_source()
    wb = openpyxl.load_workbook(src, data_only=True)
    questions = []
    warnings = []

    for sheet_index, ws in enumerate(wb.worksheets):
        rows = list(ws.iter_rows(values_only=True))
        header = tuple(clean(c) for c in rows[0][:7])
        if header != HEADER:
            sys.exit("[LỖI] Tiêu đề cột sheet '%s' khác mong đợi: %r" % (ws.title, header))
        prefix = "S%d" % (sheet_index + 1)
        last = None
        for row_number, row in enumerate(rows[1:], start=2):
            cells = [clean(c) for c in row[:7]]
            if all(c in (None, "") for c in cells):
                continue
            stt, topic, level, text, correct, wrong1, wrong2 = cells
            if stt is None and text == "Giải thích":
                if last is None or "explanation" in last:
                    sys.exit("[LỖI] Dòng giải thích không gắn được với câu nào: sheet '%s' dòng %d" % (ws.title, row_number))
                last["explanation"] = correct
                continue
            if level not in DIFFICULTY:
                sys.exit("[LỖI] Độ khó không nhận dạng được %r ở sheet '%s' dòng %d" % (level, ws.title, row_number))
            options = [correct, wrong1, wrong2]
            if any(not isinstance(o, str) or not o for o in options) or not text:
                sys.exit("[LỖI] Thiếu nội dung câu hỏi/đáp án ở sheet '%s' dòng %d" % (ws.title, row_number))
            if len(set(options)) != 3:
                sys.exit("[LỖI] Đáp án trùng nhau ở sheet '%s' dòng %d" % (ws.title, row_number))
            last = {
                "id": "%s-%02d" % (prefix, int(stt)),
                "sheet": ws.title,
                "row": row_number,
                "stt": int(stt),
                "topic": topic,
                "difficulty": DIFFICULTY[level],
                "difficultyLabel": level,
                "text": text,
                "correct": correct,
                "wrong": [wrong1, wrong2],
            }
            questions.append(last)

    ids = [q["id"] for q in questions]
    if len(set(ids)) != len(ids):
        sys.exit("[LỖI] Trùng mã câu hỏi (STT trùng trong cùng sheet).")
    texts = [q["text"] for q in questions]
    if len(set(texts)) != len(texts):
        warnings.append("Có câu hỏi trùng nội dung.")

    counts = {}
    for q in questions:
        counts[q["difficulty"]] = counts.get(q["difficulty"], 0) + 1

    bank = {
        "source": os.path.basename(src),
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "counts": counts,
        "total": len(questions),
        "questions": questions,
    }
    body = json.dumps(bank, ensure_ascii=False, indent=1)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* TỰ ĐỘNG TẠO bởi tools/convert_questions.py — KHÔNG sửa tay.\n")
        f.write("   Muốn đổi câu hỏi: sửa file Excel rồi chạy lại công cụ chuyển đổi. */\n")
        f.write("(function (root) {\n  var bank = ")
        f.write(body)
        f.write(";\n  root.HQ_QUESTION_BANK = bank;\n")
        f.write("  if (typeof module !== 'undefined' && module.exports) module.exports = bank;\n")
        f.write("})(typeof window !== 'undefined' ? window : globalThis);\n")

    print("Nguồn:", src)
    print("Đã ghi:", OUT_PATH)
    print("Tổng: %d câu | dễ: %d | trung bình: %d | khó: %d | có giải thích: %d" % (
        len(questions), counts.get("easy", 0), counts.get("medium", 0), counts.get("hard", 0),
        sum(1 for q in questions if "explanation" in q)))
    for w in warnings:
        print("[CẢNH BÁO]", w)


if __name__ == "__main__":
    main()
