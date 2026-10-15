"""Build the Ignite deck PDF: 20 pages, each set to auto-advance after 15 s.

    uv run --with pypdf python talks/reversim-2026/build.py

Writes slides.pdf and notes.md next to this file. Page /Dur is honoured by
full-screen PDF viewers (Acrobat, Preview slideshow is manual).
"""

import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SLIDE_SECONDS = 15


def main() -> None:
    src = (HERE / "index.html").read_text()
    qr = (HERE / "qr-app.svg").read_text()
    built = src.replace("<!--QR-->", qr)

    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "deck.html"
        page.write_text(built)
        raw = Path(tmp) / "raw.pdf"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             "--virtual-time-budget=3000", f"--print-to-pdf={raw}", page.as_uri()],
            check=True, capture_output=True,
        )
        writer = PdfWriter(clone_from=PdfReader(raw))
        for p in writer.pages:
            p[NameObject("/Dur")] = NumberObject(SLIDE_SECONDS)
        writer.write(HERE / "slides.pdf")
        n = len(writer.pages)

    notes = re.findall(r'<aside class="notes">(.*?)</aside>', src, re.S)
    lines = ["# Speaker notes: 15 s per slide (~40 words)\n"]
    for k, text in enumerate(notes, 1):
        clean = html.unescape(re.sub(r"\s+", " ", text).strip())
        lines.append(f"{k}. ({len(clean.split())} words) {clean}\n")
    (HERE / "notes.md").write_text("\n".join(lines))

    print(f"slides.pdf: {n} pages · notes.md: {len(notes)} slides")
    if n != 20:
        sys.exit(f"expected 20 pages, got {n}")


if __name__ == "__main__":
    main()
