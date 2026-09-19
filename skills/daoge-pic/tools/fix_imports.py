#!/usr/bin/env python3
"""按「名字 → 模块」映射重建 import 头（界面批 E 的搬运收尾工具）。

映射来源：git HEAD 的 web/src/main.jsx（拆分前的完整 import 表）。
新文件在 app/ 下：main 的 './app/x' → './x'；其余 './x' → '../x'。
用法：python3 tools/fix_imports.py web/src/app/workbench-controller.jsx web/src/app/workbench-app.jsx [--keep <名字>...]
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TS = ['npx', 'tsc', '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx', '--module', 'esnext',
      '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck']


def source_map():
    text = subprocess.run(['git', 'show', 'HEAD:skills/daoge-pic/web/src/main.jsx'],
                          cwd=ROOT.parent.parent, capture_output=True, text=True).stdout
    imap, lucide = {}, []
    for m in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        names = [x.strip().split(' as ')[-1] for x in m.group(1).split(',')]
        if m.group(2) == 'lucide-react':
            lucide += names
            for n in names:
                imap[n] = 'lucide-react'
        else:
            for n in names:
                imap[n] = m.group(2)
    return imap, lucide


def rel(mod, in_app=True):
    if not in_app:
        return mod
    if mod.startswith('./app/'):
        return './' + mod[len('./app/'):]
    return ('../' + mod[2:]) if mod.startswith('./') else mod


def fix(path, imap, keep):
    p = ROOT / path
    text = p.read_text()
    # 去掉所有 import 行
    body_lines = [l for l in text.split('\n') if not l.startswith('import ')]
    body = '\n'.join(body_lines).lstrip('\n')
    used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', body)) | set(keep)
    by = {}
    for n in sorted(used):
        mod = imap.get(n)
        if mod:
            by.setdefault(rel(mod), []).append(n)
    head = ''
    for mod, ns in sorted(by.items()):
        head += "import { " + ', '.join(ns) + " } from '" + mod + "';\n"
    p.write_text(head + '\n' + body)
    out = subprocess.run(TS + [str(p)], capture_output=True, text=True).stdout
    missing = sorted(set(re.findall(r"error TS2304: Cannot find name '([A-Za-z_][A-Za-z0-9_]*)'", out)))
    print(path, '| import 行:', head.count('\n'), '| 仍缺:', missing)


if __name__ == '__main__':
    imap, lucide = source_map()
    args = sys.argv[1:]
    keep = args[args.index('--keep') + 1:] if '--keep' in args else []
    for f in [a for a in args if not a.startswith('--') and a not in keep]:
        fix(f, imap, keep)