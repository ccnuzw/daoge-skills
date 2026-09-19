#!/usr/bin/env python3
"""E1.6b：把 App 的返回壳抽成 app/workbench-shell.jsx（行为零变化）。

壳里用到的名字分两类：
  - main 的 import（图标/组件/模型）→ 壳文件自带 import；
  - App 本地绑定（state/handler/setter）→ 变成 props，调用点回填。
用编译器循环收敛（缺谁补谁），直到 tsc 对壳文件无 TS2304。
"""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / 'web/src/main.jsx'
SHELL = ROOT / 'web/src/app/workbench-shell.jsx'
TS = ['npx', 'tsc', '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx', '--module', 'esnext',
      '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck']


def main_import_map():
    text = MAIN.read_text()
    import_of, lucide = {}, set()
    for m in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        names = [x.strip().split(' as ')[-1] for x in m.group(1).split(',')]
        if m.group(2) == 'lucide-react':
            lucide |= set(names)
        for n in names:
            import_of[n] = m.group(2)
    return import_of, lucide


def extract_shell():
    text = MAIN.read_text()
    i = text.index('function App() {')
    j = text.index('\nfunction renderWorkbench()', i)
    body = text[i:j]
    r = body.rindex('  return <main ')
    jsx_start = i + r + len('  return ')
    end_marker = '\n  </main>;'
    k = text.index(end_marker, jsx_start) + len('\n  </main>')
    jsx = text[jsx_start:k]
    # App 内替换成 <WorkbenchShell ... />
    new_text = text[:jsx_start] + 'return <WorkbenchShell __props__ />' + text[k + 1:]
    MAIN.write_text(new_text)
    return jsx


def render_shell(jsx, props, imports):
    by_mod = {}
    for n in imports:
        by_mod.setdefault(import_map[n], []).append(n)
    head = ''
    for mod, ns in sorted(by_mod.items()):
        path = ('../' + mod[2:]) if mod.startswith('./') else mod
        head += "import { " + ', '.join(sorted(ns)) + " } from '" + path + "';\n"
    destructure = ', '.join(sorted(props)) if props else ''
    return (head + "\n/** 界面批 E（E1.6b）从 App 的返回壳搬出（行为零变化）。 */\n"
            + f"export function WorkbenchShell({{ {destructure} }}) {{\n  return (\n{jsx}\n  );\n}}\n")


def main():
    global import_map
    import_map, _lucide = main_import_map()
    jsx = extract_shell()
    props = set()
    for round_no in range(20):
        imports = set()
        used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', jsx))
        imports = {n for n in used if n in import_map}
        SHELL.write_text(render_shell(jsx, props, imports))
        out = subprocess.run(TS + [str(SHELL)], capture_output=True, text=True).stdout
        missing = sorted(set(re.findall(r"error TS2304: Cannot find name '([A-Za-z_][A-Za-z0-9_]*)'", out)))
        if not missing:
            print('收敛：第', round_no, '轮，props', len(props), '个')
            break
        new = [n for n in missing if n not in import_map]
        props |= set(new)
        print('轮', round_no, '缺:', missing, '→ 新增 props:', new)
    # 回填调用点
    text = MAIN.read_text()
    props_jsx = ' '.join(f'{k}={{{k}}}' for k in sorted(props))
    text = text.replace('<WorkbenchShell __props__ />', f'<WorkbenchShell {props_jsx} />', 1)
    anchor = "import { api } from './app/api.js';"
    text = text.replace(anchor, anchor + "\nimport { WorkbenchShell } from './app/workbench-shell.jsx';", 1)
    MAIN.write_text(text)
    print('main 行数:', len(text.split('\n')), '| 壳行数:', len(SHELL.read_text().split('\n')))


if __name__ == '__main__':
    main()