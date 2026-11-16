# 批文卡宋體子集（階段 2c）：Android 很多手機沒有宋體，App 只打包批文卡會用到的字。
#
# 來源：Google Noto Serif SC（noto-cjk，SIL Open Font License 1.1，可商用、可改、可隨 App 發布）
#   https://github.com/notofonts/noto-cjk/raw/main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf
#   https://github.com/notofonts/noto-cjk/raw/main/Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf
#   授權全文：https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE（複本在 assets/fonts/OFL.txt）
#
# 用字清單：
#   一般體（卡上填的資料：公司、司機姓名、口岸、顏色等，簡繁都可能）：
#     GB2312 一、二級全部 6763 字 ＋ Big5 常用字（A440–C67E）5401 字 ＋ ASCII ＋ 卡面標點；
#   粗體（標籤、標題、簽發機關、底部提示，和 Arial 缺字時的英文數字）：
#     lib/business/approval_card.dart 裏 approvalCard* 常數的字 ＋ ASCII。
#   保留字型 name 表全部欄位（包括授權說明，OFL 要求隨字型附上授權）。
#
# 用法（需要 Python 3 和 fontTools；字型下載到 app/ 以外的目錄）：
#   python3 -I tool/song_subset.py <NotoSerifSC-Regular.otf> <NotoSerifSC-Bold.otf>
# 輸出：assets/fonts/DualplateSong-Regular.otf、DualplateSong-Bold.otf
import os
import re
import sys
from fontTools import subset

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASCII = ''.join(chr(c) for c in range(0x20, 0x7F))
PUNCT = '·、：。，（）—–　／'


def gb2312():
    out = set()
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return out


def big5_common():
    out = set()
    for hi in range(0xA4, 0xC7):
        for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            try:
                c = bytes([hi, lo]).decode('big5')
            except UnicodeDecodeError:
                continue
            if '一' <= c <= '鿿':
                out.add(c)
    return out


def card_fixed_text():
    src = open(os.path.join(APP, 'lib', 'business', 'approval_card.dart'), encoding='utf-8').read()
    block = src[src.index('const approvalCardTitle'):src.index('class ApprovalCard ')]
    return set(''.join(re.findall(r"'([^']*)'", block)))


def run(font, text, out):
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.layout_features = ['*']
    options.notdef_outline = True
    options.hinting = False
    f = subset.load_font(font, options)
    s = subset.Subsetter(options)
    s.populate(text=text)
    s.subset(f)
    subset.save_font(f, out, options)
    print(out, len(text), 'chars', os.path.getsize(out), 'bytes')


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__ or 'usage: song_subset.py Regular.otf Bold.otf')
    fixed = card_fixed_text()
    regular = ''.join(sorted(gb2312() | big5_common() | set(ASCII) | set(PUNCT) | fixed))
    bold = ''.join(sorted(fixed | set(ASCII) | set(PUNCT)))
    dest = os.path.join(APP, 'assets', 'fonts')
    os.makedirs(dest, exist_ok=True)
    run(sys.argv[1], regular, os.path.join(dest, 'DualplateSong-Regular.otf'))
    run(sys.argv[2], bold, os.path.join(dest, 'DualplateSong-Bold.otf'))


main()
