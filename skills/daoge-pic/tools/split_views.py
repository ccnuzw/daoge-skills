#!/usr/bin/env python3
"""E1.6：把 App 里的 viewRenderers 逐个拆成 views/*.jsx（行为零变化）。

对每个入口：
  1. 取出 `page('id', CONTENT)` 的 CONTENT（`renderXxx()` 形式先内联其箭头体）；
  2. CONTENT 用到的「App 本地绑定」→ 生成 props 并在调用点回填；
  3. 用到的 import 名 → 按 main 的模块映射在视图文件里 import（views/ 深度 → ../）；
  4. assets 与 trash 共用同一个 `renderAssetsView()` → 只生成一个 AssetsView，两处复用。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN = ROOT / 'web/src/main.jsx'


def load_maps():
    text = MAIN.read_text()
    import_of, lucide = {}, set()
    for m in re.finditer(r"^import \{([^}]+)\} from '([^']+)';", text, re.M):
        names = [x.strip().split(' as ')[-1] for x in m.group(1).split(',')]
        if m.group(2) == 'lucide-react':
            lucide |= set(names)
        for n in names:
            import_of[n] = m.group(2)
    app_body = text[text.index('function App() {'):text.index('const viewRenderers = {')]
    app_local = set(re.findall(r'^  (?:const|function|let) ([A-Za-z_][A-Za-z0-9_]*)', app_body, re.M))
    for m in re.finditer(r'^  const \{([^}]+)\} =', app_body, re.M):
        app_local |= {x.strip().split(':')[-1].strip().split('=')[0].strip() for x in m.group(1).split(',')}
    for m in re.finditer(r'^  const \[([^\]]+)\] =', app_body, re.M):
        app_local |= {x.strip() for x in m.group(1).split(',')}
    return text, import_of, lucide, app_local


def camel(key):
    return ''.join(p.capitalize() for p in re.split(r'[^A-Za-z0-9]+', key) if p)


def page_content(body):
    text = body.strip()
    m = re.match(r"page\('([\w-]+)',\s*", text)
    if not m:
        raise SystemExit('无法解析入口：' + text[:80])
    i = m.end()
    depth, quote, out = 0, None, []
    while i < len(text):
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == quote and text[i - 1] != '\\':
                quote = None
        elif ch in '\'"`':
            quote = ch
            out.append(ch)
        elif ch in '([{':
            depth += 1
            out.append(ch)
        elif ch in ')]}':
            if depth == 0:
                break
            depth -= 1
            out.append(ch)
        else:
            out.append(ch)
        i += 1
    return m.group(1), ''.join(out).strip()


def inline_renderer(text, name):
    m = re.search(r'^  const ' + name + r' = \(\) => ', text, re.M)
    if not m:
        raise SystemExit('找不到内联渲染函数：' + name)
    nxt = re.search(r'^  (?:const|function|let) ', text[m.end():], re.M)
    chunk = text[m.end():m.end() + nxt.start()] if nxt else text[m.end():]
    cut = chunk.rindex(';')          # 箭头体的终止分号（其后可能是注释/空行）
    return chunk[:cut].strip()


def import_head(names, import_of):
    by_mod = {}
    for n in names:
        by_mod.setdefault(import_of[n], []).append(n)
    head = ''
    for mod, ns in sorted(by_mod.items()):
        path = ('../' + mod[2:]) if mod.startswith('./') else mod
        head += "import { " + ', '.join(sorted(ns)) + " } from '" + path + "';\n"
    return head


def main():
    text, import_of, lucide, app_local = load_maps()
    i = text.index('const viewRenderers = {')
    j = text.index('\n  };', i) + 4
    block = text[i:j]
    pat = re.compile(r"^    (?:'([\w-]+)'|([\w-]+)): \(\) => ([\s\S]*?)(?=^    (?:'[\w-]+'|[\w-]+): |\n  \};)", re.M)
    matches = list(pat.finditer(block))
    written = {}
    for m in reversed(matches):
        key = m.group(1) or m.group(2)
        view_id, content = page_content(m.group(3))
        extra = []
        if re.match(r'^render\w+\(\)$', content):
            content = inline_renderer(text, re.match(r'^(\w+)\(\)$', content).group(1))
            extra = ['routeView']
        used = set(re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\b', content))
        props = sorted((used & app_local) - {'page'} | set(extra))
        comp = 'AssetsView' if view_id in ('assets', 'trash') else camel(view_id) + 'View'
        fname = 'assets' if view_id in ('assets', 'trash') else view_id
        if fname not in written:
            imports_needed = sorted((used - app_local) & import_of.keys())
            src = (import_head(imports_needed, import_of)
                   + "\n/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */\n"
                   + f"export function {comp}({{ {', '.join(props)} }}) {{\n  return <>{content}</>;\n}}\n")
            (ROOT / 'web/src/views').mkdir(parents=True, exist_ok=True)
            (ROOT / f'web/src/views/{fname}.jsx').write_text(src)
            written[fname] = props
        props_jsx = ' '.join(f'{k}={{{k}}}' for k in written[fname])
        new_entry = f"    {repr(key)}: () => page('{view_id}', <{comp} {props_jsx} />),\n"
        block = block[:m.start()] + new_entry + block[m.end():]
    text = text[:i] + block + text[j:]
    # import 视图
    anchor = "import { api } from './app/api.js';"
    views = sorted(set(written))
    lines = []
    for f in views:
        comp = 'AssetsView' if f == 'assets' else camel(f) + 'View'
        lines.append(f"import {{ {comp} }} from './views/{f}.jsx';")
    text = text.replace(anchor, anchor + '\n' + '\n'.join(lines), 1)
    MAIN.write_text(text)
    print('已拆视图:', ', '.join(views), '| main 行数:', len(text.split('\n')))


if __name__ == '__main__':
    main()