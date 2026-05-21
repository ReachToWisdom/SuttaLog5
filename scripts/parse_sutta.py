"""평문 자애경 텍스트를 게송별 JSON으로 파싱.

자애경 라인 패턴:
  1. 타이틀 (1줄)
  2. 배경/서지 ("(한)" 시작, 들여쓰기로 구분)
  3. 게송 시작: ^\d+\.  (빠알리 원문)
  4. 빠알리 후속 줄 (번역자 만나기 전까지)
  5. 번역: ^\((초기불전연구원|한국빠알리성전협회|아짜리야 붓다락키따 스님|냐나몰리 스님|담마간다 스님)\)
  6. 출처: 번역 직후 들여쓰기 시작
  7. 단어: ^<단어>\s*[:=]
  8. 주석: ^\[주석
  9. 메모: ^#
"""
import json
import re
import sys
from pathlib import Path

TRANSLATORS = [
    "초기불전연구원",
    "한국빠알리성전협회",
    "아짜리야 붓다락키따 스님",
    "냐나몰리 스님",
    "담마간다 스님",
]
TRANSLATOR_ABBR = {
    "초": "초기불전연구원",
    "한": "한국빠알리성전협회",
    "아": "아짜리야 붓다락키따 스님",
    "냐": "냐나몰리 스님",
    "담": "담마간다 스님",
}
TR_RE = re.compile(r"^\(([^)]+)\)\s*(.*)")
VERSE_RE = re.compile(r"^(\d+)\.\s*(.*)")
WORD_RE = re.compile(r"^([a-zA-ZāīūṃṅñṭḍṇḷĀĪŪṂṄÑṬḌṆḶōōÑà-ſ]+)\s*[:=]\s*(.*)")


def is_indented(line):
    return line.startswith(" ")


def is_pali_continuation(line):
    """게송 첫 줄 다음의 빠알리 원문 후속 줄 (번역자 prefix 없고, 단어 분해도 아님)."""
    if not line.strip():
        return False
    if TR_RE.match(line):
        return False
    if VERSE_RE.match(line):
        return False
    if WORD_RE.match(line):
        return False
    if line.lstrip().startswith("["):
        return False
    if line.lstrip().startswith("#"):
        return False
    if line.lstrip().startswith('"') or line.lstrip().startswith("“"):
        return False
    if line.startswith("(번역)"):
        return False
    # 빠알리 라틴 음역인지 확인 (괄호 안 텍스트도 허용)
    return bool(re.search(r"[a-zA-Zāīūṃ]", line))


def parse_sutta(text):
    lines = text.split("\n")
    result = {
        "id": "sn1.8",
        "title": {},
        "background": "",
        "verses": [],
    }

    # 헤더: 라인 1 = 타이틀, 라인 2 = 배경
    if lines:
        title_line = lines[0]
        m = re.match(r"^(.+?)\s*\(([^,)]+)(?:,\s*(.+?))?\)\s*$", title_line)
        if m:
            result["title"] = {
                "ko": m.group(1).strip(),
                "pali": m.group(2).strip(),
                "ref": (m.group(3) or "").strip(),
            }
        else:
            result["title"] = {"ko": title_line.strip()}

    if len(lines) > 1:
        result["background"] = lines[1].strip()

    # 게송 anchor 찾기
    anchors = [(i, m.group(1), m.group(2))
               for i, line in enumerate(lines)
               for m in [VERSE_RE.match(line)] if m]

    for idx, (start, num, first_pali) in enumerate(anchors):
        end = anchors[idx + 1][0] if idx + 1 < len(anchors) else len(lines)
        verse = parse_verse(int(num), lines[start:end], first_pali)
        result["verses"].append(verse)

    return result


def parse_verse(num, block, first_pali):
    verse = {
        "n": num,
        "pali": [first_pali] if first_pali else [],
        "translations": {},
        "translation_sources": {},
        "translation_notes": {},  # 들여쓰기로 분리된 번역 직후 각주
        "words": [],
        "extra": [],  # 메모(#), 주석([주석:..]), 인용 등
    }

    # block[0]은 첫 게송 줄. 다음 줄부터 처리.
    i = 1
    state = "pali"  # pali | translations | words
    current_translator = None

    while i < len(block):
        line = block[i]
        stripped = line.strip()

        # 번역자 마커
        m = TR_RE.match(line)
        if m:
            translator, body = m.group(1), m.group(2)
            if translator in TRANSLATOR_ABBR:
                translator = TRANSLATOR_ABBR[translator]
            if translator in TRANSLATORS:
                state = "translations"
                current_translator = translator
                verse["translations"][translator] = body.strip()
                # 다음 줄들이 번역의 multi-line 본문이거나 출처일 수 있음
                i += 1
                continued_lines = []
                while i < len(block):
                    nxt = block[i]
                    if not nxt.strip():
                        i += 1
                        continue
                    if TR_RE.match(nxt) or VERSE_RE.match(nxt):
                        break
                    if WORD_RE.match(nxt) and not is_indented(nxt):
                        break
                    if is_indented(nxt):
                        # 출처
                        verse["translation_sources"][translator] = nxt.strip()
                        i += 1
                        # 다음 줄로 (출처가 1줄로 끝남 보통)
                        continue
                    # 번역 multi-line 후속
                    continued_lines.append(nxt.strip())
                    i += 1
                if continued_lines:
                    verse["translations"][translator] += "\n" + "\n".join(continued_lines)
                continue

        # 빠알리 후속 (state=pali일 때만)
        if state == "pali":
            if is_pali_continuation(line):
                verse["pali"].append(stripped)
                i += 1
                continue
            else:
                state = "translations"  # 빠알리 종료 신호

        # 단어 분해
        wm = WORD_RE.match(line)
        if wm and state in ("translations", "words"):
            state = "words"
            term, gloss = wm.group(1), wm.group(2)
            entry = {"term": term, "gloss": gloss.strip()}
            # 후속 줄: 들여쓰기, [주석, # 메모, 인용 — 다 다음 단어 만나기 전까지 entry["extra"]에 누적
            extras = []
            i += 1
            while i < len(block):
                nxt = block[i]
                if not nxt.strip():
                    i += 1
                    continue
                if WORD_RE.match(nxt) and not is_indented(nxt):
                    break
                if VERSE_RE.match(nxt):
                    break
                if TR_RE.match(nxt):
                    break
                extras.append(nxt.rstrip())
                i += 1
            if extras:
                entry["extras"] = extras
            verse["words"].append(entry)
            continue

        # 그 외는 extra로
        if stripped:
            verse["extra"].append(stripped)
        i += 1

    return verse


def main():
    if len(sys.argv) != 3:
        print("usage: parse_sutta.py <input.txt> <output.json>")
        sys.exit(1)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    text = src.read_text(encoding="utf-8")
    data = parse_sutta(text)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n_verses = len(data["verses"])
    n_words = sum(len(v["words"]) for v in data["verses"])
    print(f"Wrote {dst}: {n_verses} verses, {n_words} words")


if __name__ == "__main__":
    main()
