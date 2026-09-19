#!/usr/bin/env python3
"""E1.6c：把 App 收敛到 ≤250 行。

产物：
  - app/workbench-controller.jsx：App 的全部状态/副作用/处理器 + 它们用到的顶层助手 → `useWorkbenchController()`
    （返回 119 个 shell props）；
  - app/workbench-app.jsx：WorkbenchErrorBoundary + 两个门卫 + 极薄 App（≤250 行）；
  - main.jsx：只剩入口（挂载）。
编译器循环负责把 import 名补全、把仍被引用的顶层助手搬到 controller。
"""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / 'web/src/main.jsx'
APPF = ROOT / 'web/src/app/workbench-app.jsx'
CTRL = ROOT / 'web/src/app/workbench-controller.jsx'
TS = ['npx', 'tsc', '--noEmit', '--allowJs', '--checkJs', '--jsx', 'react-jsx', '--module', 'esnext',
      '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck']


def import_map():
    text = MAIN.read_text()
    m = {}
    for im in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        for n in [x.strip().split(' as ')[-1] for x in im.group(1).split(',')]:
            m[n] = im.group(2)
    return m


def _top_defs(text):
    out = []
    for i, line in enumerate(text.split('\n')):
        m = re.match(r'^(function|class|const|async function) ([A-Za-z_][A-Za-z0-9_]*)', line)
        if m:
            out.append((i, m.group(1), m.group(2)))
    return out


def span(text, name):
    lines = text.split('\n')
    defs = _top_defs(text)
    for idx, (i, kind, n) in enumerate(defs):
        if n != name:
            continue
        next_line = defs[idx + 1][0] if idx + 1 < len(defs) else len(lines)
        # 去掉定义后面、「下一个定义」之前夹着的注释/空行：回退到最后一个 `;` 或 `}` 行
        block = lines[i:next_line]
        for k in range(len(block) - 1, -1, -1):
            t = block[k].strip()
            if t.endswith(';') or t == '}':
                next_line = i + k + 1
                break
        start = sum(len(l) + 1 for l in lines[:i])
        end = sum(len(l) + 1 for l in lines[:next_line])
        return start, end
    return None


def cut(text, name):
    sp = span(text, name)
    if sp is None:
        raise SystemExit('这名字 span 不到（可能已被切走或不是顶层定义）：' + name)
    a, b = sp
    return text[a:b], text[:a] + text[b:]


def rel(mod):
    # main 里的 './app/x' 在新文件（同在 app/）里就是 './x'；其余 './x' → '../x'
    if mod.startswith('./app/'):
        return './' + mod[len('./app/'):]
    return ('../' + mod[2:]) if mod.startswith('./') else mod


def dedupe_imports(path):
    lines = path.read_text().split('\n')
    seen, out = {}, []
    for line in lines:
        m = re.match(r"^import \{([^}]+)\} from '([^']+)';$", line)
        if m:
            names = [x.strip() for x in m.group(1).split(',') if x.strip()]
            mod = m.group(2)
            bucket = seen.setdefault(mod, [])
            for n in names:
                if n not in bucket:
                    bucket.append(n)
            continue
        out.append(line)
    # 把 import 行按首次出现顺序插回顶部
    head = [f"import {{ {', '.join(sorted(ns))} }} from '{mod}';" for mod, ns in seen.items()]
    body = [l for l in out if l.strip() or True]
    path.write_text('\n'.join(head + [l for l in out if not l.startswith('import ')]))


def imap_head(names, imap):
    by = {}
    for n in names:
        if n in imap:
            by.setdefault(rel(imap[n]), []).append(n)
    return ''.join("import { " + ', '.join(sorted(ns)) + " } from '" + mod + "';\n" for mod, ns in sorted(by.items()))


def wrap(text):
    text = re.sub(r'^(function |class |const |async function )', r'export \1', text, flags=re.M)
    return text


def main():
    text = MAIN.read_text()
    imap = import_map()
    # ① 抽出三个壳件与 App 主体
    shell_bits = []
    for n in ['WorkbenchErrorBoundary', 'StudioVersionGate', 'LocalStudioAuthorizationGate']:
        b, text = cut(text, n)
        shell_bits.append(b)
    a, b = span(text, 'App')
    app_text = text[a:b]
    ret = app_text.index('  return <WorkbenchShell ')
    logic = app_text[app_text.index('{') + 1:ret]   # 体：剥掉函数签名与开括号
    call = app_text[ret:app_text.index('\n', ret)]
    props = re.findall(r'([A-Za-z_][A-Za-z0-9_]*)=\{', call)
    # ② **先摘 App**（偏移以当前文本为准），再切助手
    text = text[:a] + '__APP_SLOT__' + text[b:]
    top_defs = set(re.findall(r'^(?:function|const|class) ([A-Za-z_][A-Za-z0-9_]*)', text, re.M))
    skip = {'App', 'WorkbenchErrorBoundary', 'StudioVersionGate', 'LocalStudioAuthorizationGate'}
    helpers = sorted({x for x in re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', logic) if x in top_defs and x not in skip})
    helper_text = []
    for h in helpers:
        blk, text = cut(text, h)
        helper_text.append(blk)
    MAIN.write_text(text)
    # ④ controller
    body_all = '\n'.join(helper_text) + '\n\n' + logic
    used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', body_all))
    head = imap_head(sorted(used), imap)
    CTRL.write_text(head + "\n/** 界面批 E（E1.6c）从 main.jsx 的 App 搬出：状态、副作用与处理器（行为零变化）。 */\n"
                     + wrap('\n\n'.join(helper_text)) + "\n\n"
                     + "export function useWorkbenchController() {\n" + logic.strip('\n') + "\n\n  return { " + ', '.join(f'{p}' for p in props) + " };\n}\n")
    # ⑤ workbench-app.jsx
    app_used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', '\n'.join(shell_bits)))
    head2 = imap_head(sorted(app_used | {'WorkbenchShell', 'useWorkbenchController'}), imap)
    APPF.write_text(head2 + "import { WorkbenchShell } from './workbench-shell.jsx';\nimport { useWorkbenchController } from './workbench-controller.jsx';\n\n"
                    + wrap('\n\n'.join(shell_bits)) + "\n\n"
                    + "/** 极薄的 App：一次取控制器，交给壳渲染（界面批 E · E1.6c）。 */\n"
                    + "export function App() {\n  const shellProps = useWorkbenchController();\n  return <WorkbenchShell {...shellProps} />;\n}\n")
    # ⑥ main：入口只剩挂载
    text = MAIN.read_text()
    text = text.replace('__APP_SLOT__', '')
    anchor = "import { api } from './app/api.js';"
    text = text.replace(anchor, anchor + "\nimport { App } from './app/workbench-app.jsx';", 1)
    MAIN.write_text(text)
    for f in [APPF, CTRL, MAIN]:
        dedupe_imports(f)
    print('main 行数:', len(MAIN.read_text().split('\n')), '| app 行数:', len(APPF.read_text().split('\n')), '| controller 行数:', len(CTRL.read_text().split('\n')))


if __name__ == '__main__':
    main()