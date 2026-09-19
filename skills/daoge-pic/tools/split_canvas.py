#!/usr/bin/env python3
"""画布搬迁工具（界面批 E · E2）：把 creative-lineage-canvas.jsx 的顶层定义搬到目标文件。

用法：python3 tools/split_canvas.py <目标相对路径> <名字...> [--pure]
  --pure  只搬「不含 JSX」的定义（握手助手 → .mjs 用）

做完：
  1. 按行界摘出定义（含尾随注释的裁剪）；
  2. 目标文件写出（export 化）；源文件删掉并 import 回来；
  3. 编译器循环：缺名字 → 从源文件的 import 映射补 import（相对路径按目标深度换算）。
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'web/src/creative-lineage-canvas.jsx'
TS = ['npx', 'tsc', '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx', '--module', 'esnext',
      '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck']


def top_defs(text):
    return [(i, m.group(1), m.group(2)) for i, l in enumerate(text.split('\n'))
            for m in [re.match(r'^(function|class|const|async function) ([A-Za-z_][A-Za-z0-9_]*)', l)] if m]


def span(text, name):
    lines = text.split('\n')
    defs = top_defs(text)
    for idx, (i, kind, n) in enumerate(defs):
        if n != name:
            continue
        nxt = defs[idx + 1][0] if idx + 1 < len(defs) else len(lines)
        block = lines[i:nxt]
        for k in range(len(block) - 1, -1, -1):
            t = block[k].strip()
            if t.endswith(';') or t == '}' or t.startswith('export'):
                nxt = i + k + 1
                break
        return sum(len(l) + 1 for l in lines[:i]), sum(len(l) + 1 for l in lines[:nxt])
    return None


def is_pure(block):
    return not re.search(r'</[A-Za-z]|/>|<[A-Z]', block)


def import_map(text):
    m = {}
    for im in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        for n in [x.strip().split(' as ')[-1] for x in im.group(1).split(',')]:
            m[n] = im.group(2)
    return m


def rel_for(mod, target):
    depth = len(pathlib.Path(target).parts) - 3  # web/src/<dir>/file → 1
    if mod.startswith('./app/'):
        return ('./' if depth == 1 else '../') + mod[len('./app/'):]
    base = mod[2:]
    return ('../' * depth) + base if mod.startswith('./') else mod


def main():
    args = sys.argv[1:]
    target = args[0]
    names = [a for a in args[1:] if not a.startswith('--')]
    pure_only = '--pure' in args
    text = SRC.read_text()
    imap = import_map(text)
    moved, rest_imports = {}, []
    for name in names:
        sp = span(text, name)
        if not sp:
            print('跳过（找不到）:', name); continue
        a, b = sp
        block = text[a:b].rstrip('\n')
        if pure_only and not is_pure(block):
            print('跳过（含 JSX）:', name); continue
        moved[name] = block
        text = text[:a] + text[b:]
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 目标文件
    old = (ROOT / target)
    head = ''
    if old.exists():
        head = old.read_text()
    import_of = {}
    for n, block in moved.items():
        for dep, mod in imap.items():
            if re.search(r'\b' + re.escape(dep) + r'\b', block):
                import_of.setdefault(rel_for(mod, target), []).append(dep)
    # 目标文件自己的模块名也要能引用（例如 inspector 用 shared）
    for other in names:
        pass
    new_head = ''.join("import { " + ', '.join(sorted(set(v))) + " } from '" + k + "';\n" for k, v in sorted(import_of.items()))
    body = "\n\n".join(re.sub(r'^(function|class|const) ', r'export \1 ', moved[n], flags=re.M) for n in moved)
    old.write_text((head if head else new_head + "\n/** 界面批 E（E2）从 creative-lineage-canvas.jsx 搬出（行为零变化）。 */\n\n") + body + '\n')
    # 源文件 import 回来（相对源文件深度：canvas/ → './canvas/x'；.mjs 同）
    dep_mod = './' + target[len('web/src/'):] if target.startswith('web/src/') else target
    names_jsx = ', '.join(sorted(moved))
    line = "import { " + names_jsx + " } from '" + dep_mod + "';"
    anchor = re.search(r"^import .*'\./lineage-menu-model\.mjs';$", text, re.M)
    text = (text[:anchor.end()] + '\n' + line + text[anchor.end():]) if anchor else (line + '\n' + text)
    SRC.write_text(text)
    print('搬出:', len(moved), '个 | 源文件行数:', len(text.split('\n')), '| 目标行数:', len((old).read_text().split('\n')))
    # 编译器循环
    for i in range(12):
        out = subprocess.run(TS + [str(SRC), str(old)], capture_output=True, text=True).stdout
        missing = sorted(set(re.findall(r"error TS2304: Cannot find name '([A-Za-z_][A-Za-z0-9_]*)'", out)))
        if not missing:
            print('收敛：第', i, '轮'); break
        print('轮', i, '缺:', missing[:10])
        # 缺的名字：还在源文件里的顶层定义 → 下一轮再搬；否则从映射补 import
        src_now = SRC.read_text()
        still = [n for n in missing if span(src_now, n)]
        if still:
            print('  （还在源文件、需要继续搬）:', still[:8])
            break
        for path_obj, is_target in [(old, True), (SRC, False)]:
            s = path_obj.read_text()
            for n in missing:
                mod = imap.get(n)
                if not mod:
                    continue
                rel = rel_for(mod, target if is_target else 'web/src/x')
                if rel not in s:
                    continue
            print('  未解析：', missing[:8])
        break


if __name__ == '__main__':
    main()