#!/usr/bin/env python3
"""无第三方依赖的 DAOGE Docs 发布包结构检查。"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skills" / "daoge-docs"


def require(path: Path, errors: list[str]) -> None:
    if not path.is_file():
        errors.append(f"缺少发布文件：{path.relative_to(ROOT)}")


def main() -> int:
    errors: list[str] = []
    for relative in [
        "SKILL.md",
        "README.md",
        "agents/openai.yaml",
        "scripts/daoge_docs.py",
        "scripts/test_daoge_docs.py",
        "references/compatibility.md",
        "references/stack-adapters.md",
    ]:
        require(SKILL / relative, errors)
    require(ROOT / "LICENSE", errors)
    require(ROOT / "CHANGELOG.md", errors)
    require(ROOT / "CONTRIBUTING.md", errors)
    require(ROOT / "SECURITY.md", errors)
    skill = (SKILL / "SKILL.md")
    if skill.is_file():
        text = skill.read_text(encoding="utf-8")
        if not text.startswith("---\nname: daoge-docs\n"):
            errors.append("SKILL.md front matter 必须声明 name: daoge-docs")
        for command in ["doctor", "ci-check", "prepare-goal", "goal-resume-context"]:
            if command not in text:
                errors.append(f"SKILL.md 未声明核心命令：{command}")
    if errors:
        print("DAOGE Docs Skill 发布检查失败：")
        for error in errors:
            print(f"- {error}")
        return 1
    print("DAOGE Docs Skill 发布包结构通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
