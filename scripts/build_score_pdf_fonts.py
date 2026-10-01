"""Rebuild bundled PDF text fonts offline with fontTools 4.25.

Download these exact input files into a scratch directory first:
https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/files/noto-sans-sc-chinese-simplified-400-normal.woff

python scripts/build_score_pdf_fonts.py --source <variable.ttf> --common <common.woff>
Input hashes reject accidental upstream changes. Upstream SIL OFL remains in
static/pianoroll/vendor/notation/NOTO-OFL.txt. Fonts use a new family name.
"""
import argparse
import hashlib
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Options, Subsetter

args=argparse.ArgumentParser()
args.add_argument('--source',type=Path,required=True)
args.add_argument('--common',type=Path,required=True)
options=args.parse_args()
for path,digest in [(options.source,'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'),(options.common,'dc20a86875ff056a6332c353bc9a82d199bb2e5aae1d444f912c1fbff783bfa5')]:
    if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
        raise ValueError('Unexpected source font: '+str(path))
regular=instantiateVariableFont(TTFont(options.source),{'wght':400},inplace=True)
coverage=set(TTFont(options.common).getBestCmap())
coverage.update(range(0x20,0x530));coverage.update(range(0x2000,0x2770));coverage.update(range(0x3000,0x3100))
from copy import deepcopy
vendor=Path(__file__).resolve().parents[1]/'static/pianoroll/vendor/notation'
for kind,codepoints in [('Common',coverage),('Extended',regular.getBestCmap())]:
    font=deepcopy(regular)
    settings=Options();settings.hinting=False;settings.layout_features=[]
    settings.name_IDs=[0,1,2,4,5,6,13,14];settings.name_languages=[0x409];settings.glyph_names=False
    subset=Subsetter(options=settings);subset.populate(unicodes=codepoints);subset.subset(font)
    font['post'].formatType=3.0
    for name_id,value in [(1,'Hum2Song Score'),(2,'Regular'),(4,'Hum2Song Score Regular'),(6,'Hum2SongScore-Regular')]:
        font['name'].setName(value,name_id,3,1,0x409)
    target=vendor/f'ScoreText-{kind}-20261002.ttf'
    font.save(target)
    print(target.name,target.stat().st_size)
