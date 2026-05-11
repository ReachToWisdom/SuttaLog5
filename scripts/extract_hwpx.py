"""hwpx -> 평문 텍스트 추출. nested hp:p 처리 + footNote 분리."""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def local_name(tag):
    return tag.split("}", 1)[-1]


def paragraph_own_text(p):
    parts = []
    def walk(node):
        for child in node:
            tag = local_name(child.tag)
            if tag == "p":
                continue
            if tag == "footNote":
                continue  # footnote는 별도 단락으로 (skip 인라인)
            if tag == "t" and child.text:
                parts.append(child.text)
            walk(child)
    walk(p)
    return "".join(parts)


def extract_text_from_hwpx(hwpx_path):
    out_lines = []
    with zipfile.ZipFile(hwpx_path) as z:
        sections = sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n))
        for name in sections:
            with z.open(name) as f:
                root = ET.fromstring(f.read())
            for p in root.findall(".//hp:p", NS):
                text = paragraph_own_text(p).rstrip()
                if text.strip():
                    out_lines.append(text)
    return "\n".join(out_lines)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    dst = Path(sys.argv[2])
    text = extract_text_from_hwpx(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text, encoding="utf-8")
    n = text.count("\n") + 1 if text else 0
    print(f"Wrote {dst} ({len(text)} chars, {n} lines)")


if __name__ == "__main__":
    main()
