#!/usr/bin/env python3
"""通用搬迁工具（界面批 E）。用法：
  python3 lift.py <目标文件相对路径> <组件名...> [--helpers 名...]

做四件事：
  1. 按顶层函数行界从 web/src/main.jsx 摘出组件与随行助手；
  2. 新文件自动补 import（先用 main 的 import 映射，再进「编译器驱动」循环抓漏）；
  3. main.jsx 里 import 回来；
  4. 打印行数变化。不做任何行为改动。
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / 'web/src/main.jsx'
TS = ['npx', 'tsc', '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx', '--module', 'esnext',
      '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck']


def span(text, name):
    m = re.search(r'^(?:function|const|async function) ' + re.escape(name) + r'\b', text, re.M)
    if not m:
        raise SystemExit('找不到：' + name)
    # 结束点：下一个顶层声明前的**最后一个 `}` 行**（比「下一段起点」稳：不会切进别人的函数体）。
    nxt = re.search(r'^(function |class |export |const [A-Z_]|const [a-z]|async function )', text[m.end():], re.M)
    limit = m.end() + nxt.start() if nxt else len(text)
    lines = text[:limit].split('\n')
    for i in range(len(lines) - 1, -1, -1):
        if lines[i] == '}':
            cut = len('\n'.join(lines[:i + 1]))
            return m.start(), cut
    raise SystemExit('找不到结束花括号：' + name)


def main_import_map():
    text = MAIN.read_text()
    mapping, lucide = {}, set()
    for m in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        names = [x.strip().split(' as ')[-1] for x in m.group(1).split(',')]
        if m.group(2) == 'lucide-react':
            lucide |= set(names)
        for n in names:
            mapping[n] = m.group(2)
    return mapping, lucide


def to_app_path(mod):
    """main 里的模块路径 → app/ 下的相对路径。"""
    return mod[2:] if mod.startswith('./') else mod


def rel_to_app(mod_from_main):
    m = mod_from_main
    return ('../' + m[2:]) if m.startswith('./') else m


def lift(target, comps, helpers=()):
    text = MAIN.read_text()
    blocks, spans = {}, []
    for name in dict.fromkeys(list(comps) + list(helpers)):
        a, b = span(text, name)
        blocks[name] = text[a:b].rstrip('\n')
        spans.append((a, b))
        print('  [span]', name, text[:a].count('\n') + 1, '→', text[:b].count('\n') + 1, '|', blocks[name].split('\n')[0][:40])
    for a, b in sorted(spans, reverse=True):
        text = text[:a] + text[b:]
    text = re.sub(r'\n{3,}', '\n\n', text)

    def exportize(t):
        return re.sub(r'^(async function|function|const) ', r'export \1 ', t, flags=re.M)

    # 先用 main 的 import 映射铺一版头（相对路径按 app/ 深度修正）
    import_map, lucide = main_import_map()
    body = '\n\n'.join(exportize(blocks[n]) for n in dict.fromkeys(list(helpers) + list(comps)))
    used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', body))
    need = {n: import_map[n] for n in (used & import_map.keys()) if n not in blocks}
    lucide_need = sorted(n for n in need if need[n] == 'lucide-react')
    other = {}
    for n, m in need.items():
        if m != 'lucide-react':
            other.setdefault(rel_to_app(m), []).append(n)
    head = ''
    if lucide_need:
        head += 'import { ' + ', '.join(lucide_need) + " } from 'lucide-react';\n"
    for m, ns in other.items():
        head += 'import { ' + ', '.join(sorted(ns)) + " } from '" + m + "';\n"
    head += "\n/** 界面批 E 从 main.jsx 搬出（行为零变化）。 */\n\n"
    path = ROOT / target
    path.write_text(head + body + '\n')
    MAIN.write_text(text)
    return path


def fixer(path):
    """编译器驱动：把新文件里找不到的名字补成 import（先把名字映射回原模块）。"""
    import_map, lucide = main_import_map()
    for i in range(10):
        out = subprocess.run(TS + [str(path)], capture_output=True, text=True).stdout
        missing = sorted(set(re.findall(r"error TS2304: Cannot find name '([A-Za-z_][A-Za-z0-9_]*)'", out)))
        if not missing:
            print('  import 循环第', i, '轮：干净')
            return True
        s = path.read_text()
        luc, oth = [], {}
        for n in missing:
            if n in lucide:
                luc.append(n)
            elif n in import_map:
                oth.setdefault(rel_to_app(import_map[n]), []).append(n)
            else:
                print('  未知名字（要人工）:', n)
                return False
        if luc:
            s = re.sub(r"(import \{)([^}]+)(\} from 'lucide-react';)",
                       lambda m: m.group(1) + m.group(2) + ', ' + ', '.join(luc) + m.group(3), s, count=1)
        for m, ns in oth.items():
            s = "import { " + ', '.join(sorted(ns)) + " } from '" + m + "';\n" + s
        path.write_text(s)
    return False


if __name__ == '__main__':
    args = sys.argv[1:]
    target = args[0]
    comps = [a for a in args[1:] if not a.startswith('--')]
    helpers = args[args.index('--helpers') + 1:] if '--helpers' in args else []
    before = len(MAIN.read_text().split('\n'))
    p = lift(target, comps, helpers)
    fixer(p)
    print('main 行数:', before, '→', len(MAIN.read_text().split('\n')), '| 新文件行数:', len(p.read_text().split('\n')))