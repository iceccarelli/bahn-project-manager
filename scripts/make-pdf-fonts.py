#!/usr/bin/env python3
"""
Instance the two static TTFs the PDF export embeds out of the variable Inter
the app already ships.

    pip install fonttools brotli
    python3 scripts/make-pdf-fonts.py

Why this exists: @react-pdf/renderer cannot embed woff2, and the standard-14
Helvetica it falls back to carries no ToUnicode map — `pdffonts` reports
`uni no` and the resulting text cannot be searched, copied or read aloud. So
the two weights the document uses (400 and 700) are frozen out of the variable
font and committed as TTFs, which keeps the PDF face identical to the screen
face and the text extractable.
"""
import pathlib
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = next(
    ROOT.glob("node_modules/.pnpm/@fontsource-variable+inter@*/node_modules/"
              "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
    None,
)
if SRC is None:
    sys.exit("!! variable Inter not found — run `pnpm install` first")

for name, weight in (("Regular", 400), ("Bold", 700)):
    font = instancer.instantiateVariableFont(TTFont(SRC), {"wght": weight}, inplace=False)
    font.flavor = None

    # instantiateVariableFont sets usWeightClass but leaves the name table and
    # fsSelection describing the default instance, so both files still called
    # themselves "Inter Regular". @react-pdf then matched bold text to the
    # regular face and `pdffonts` listed only one subset for the whole
    # document. Stamp the identity to match the weight.
    for record in font["name"].names:
        if record.nameID in (2, 17):          # subfamily / typographic subfamily
            record.string = name
        elif record.nameID in (4, 18):        # full name / compatible full
            record.string = f"Inter {name}"
        elif record.nameID == 6:              # PostScript name
            record.string = f"Inter-{name}"
    os2 = font["OS/2"]
    if name == "Bold":
        os2.fsSelection = (os2.fsSelection & ~0b1000000) | 0b100000   # clear REGULAR, set BOLD
        font["head"].macStyle |= 0b1

    out = ROOT / "client" / "src" / "pdf" / f"Inter-{name}.ttf"
    font.save(out)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} kB)")
