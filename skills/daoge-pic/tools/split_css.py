#!/usr/bin/env python3
"""E3：把 surfaces/workbench.css 按「块归属」拆成 styles/blocks/*.css。

做法：把文件切成顶层块（规则 / @media），按**块内第一个类名**的前缀归到领域块；
workbench.css 变成汇聚入口（@import 各块）；styles.css 的分层顺序不变。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'web/src/styles/surfaces/workbench.css'
OUT = ROOT / 'web/src/styles/blocks'

RULES = [
    ('viewer.css', ['inspector-images', 'image-inspector', 'inspector-toolbar', 'inspector-select', 'inspector-action', 'inspector-image', 'inspector-readonly']),
    ('delivery.css', ['creator-delivery', 'creator-asset', 'delivery-']),
    ('canvas.css', ['lineage-', 'inspector-', 'minimap', 'shortcut', 'node-', 'edge', 'world-', 'viewport', 'selection-box', 'text-view', 'edge-label']),
    ('assets.css', ['asset-', 'selection-strip', 'selection-item', 'material-import', 'annotation-', 'trash-', 'asset-scope', 'asset-grid', 'asset-card', 'asset-count', 'empty-stage']),
    ('runs.css', ['run-', 'generation-', 'advanced-', 'evidence-', 'dry-run', 'trace-link', 'quality-metrics', 'request-card']),
    ('projects.css', ['project-', 'task-', 'overview-', 'managed-task', 'workspace-list', 'run-history-select', 'material-']),
    ('info-pages.css', ['library-', 'shared-asset', 'guide-', 'learning-', 'glossary', 'boundaries', 'phases', 'checklist']),
    ('dialogs.css', ['accessible-dialog', 'confirmation-dialog', 'creation-', 'dialog', 'reference-', 'reject-', 'derived-', 'recipe-', 'plan-edit', 'form-', 'toggle-']),
    ('settings.css', ['provider-settings', 'provider-', 'profile-', 'connection-']),
    ('dev.css', ['layout-audit', 'audit-']),
    ('shell.css', ['studio-shell', 'studio-rail', 'workspace-navigation', 'primary-navigation', 'rail-', 'workspace-breadcrumb', 'workbench-breadcrumb', 'context-strip', 'work-surface', 'workspace-chrome', 'surface-header', 'header-actions', 'project-switcher', 'status-slot', 'status-pill', 'icon-button', 'command-button', 'outline-button', 'error-strip', 'workbench-error', 'cancel-undo', 'provider-outage', 'request-', 'connection-state', 'local-auth-failure', 'loading-shell', 'fatal-error', 'brand', 'studio-version', 'workbench-']),
]


def classify(chunk):
    """按优先级扫描选择器里的族名；**所有 @media 归 responsive.css**（响应式覆盖集中一处，
    也不会让同一个选择器的媒体覆盖散到别的块文件里）。"""
    head, _, body = chunk.partition('{')
    if head.strip().startswith('@media'):
        return 'responsive.css'
    target_text = head
    classes = re.findall(r'\.([a-z][a-z0-9-]*)', target_text)
    for target, prefixes in RULES:
        for name in classes:
            if any(name.startswith(pr.rstrip('-')) for pr in prefixes):
                return target
    return 'misc.css'


def chunks_of(text):
    """按规则切（字符级花括号配对）：同一行写多条规则也各成一块；@media 整块。"""
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    out, i = [], 0
    while i < len(text):
        j = text.find('{', i)
        if j < 0:
            break
        head = text[i:j].strip()
        depth, k = 1, j + 1
        while k < len(text) and depth:
            if text[k] == '{':
                depth += 1
            elif text[k] == '}':
                depth -= 1
            k += 1
        chunk = (head + ' {' + text[j + 1:k - 1] + '}').strip()
        if chunk:
            out.append(chunk)
        i = k
    return out


def main():
    text = SRC.read_text()
    body = re.sub(r'^/\*[\s\S]*?\*/\n?', '', text, count=1)  # 去掉文件头注释
    groups = {}
    for ch in chunks_of(body):
        groups.setdefault(classify(ch), []).append(ch.strip())
    OUT.mkdir(parents=True, exist_ok=True)
    for name, chunks in sorted(groups.items()):
        (OUT / name).write_text("\n".join(chunks) + "\n")
        print(f'{name:20s} {len(chunks):5d} 块')
    SRC.write_text("""/*
 * 画布/工作台领域块（界面批 E · E3 拆分）。
 * 这里只做汇聚：每个块一个文件，一个文件只选择自己块内的类（G4 守卫在盯）。
 */
""" + "\n".join(f"@import '../blocks/{name}';" for name in sorted(groups)) + "\n")


if __name__ == '__main__':
    main()