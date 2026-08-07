#!/usr/bin/env python3
"""DAOGE Docs CLI 的隔离回归测试。"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPT = Path(__file__).with_name("daoge_docs.py")
PYTHON = sys.executable


def load_cli_module():
    """按绝对路径加载被测 CLI，避免不同 unittest 启动方式依赖 sys.path。"""
    spec = importlib.util.spec_from_file_location("daoge_docs_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 daoge_docs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DaogeDocsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="daoge-docs-test-")
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_cli(self, *args: str, expected: int = 0, vendored: bool = False) -> subprocess.CompletedProcess[str]:
        script = self.root / ".daoge-docs" / "daoge_docs.py" if vendored else SCRIPT
        result = subprocess.run(
            [PYTHON, str(script), *args],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(expected, result.returncode, msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")
        return result

    def init(self, profile: str = "strict") -> None:
        self.run_cli(
            "init",
            "--root",
            ".",
            "--project-name",
            "确定性订单平台",
            "--project-code",
            "DOP",
            "--version",
            "V1",
            "--profile",
            profile,
        )

    def write_json(self, path: Path, value: dict) -> None:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(["git", *args], cwd=self.root, text=True, capture_output=True, check=False)
        self.assertEqual(0, result.returncode, msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")
        return result

    def commit_all(self, message: str) -> None:
        if not (self.root / ".git").exists():
            self.git("init", "-q")
            self.git("config", "user.name", "DAOGE Docs Test")
            self.git("config", "user.email", "daoge-docs@example.invalid")
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def browser_payload(self) -> dict:
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        return json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])

    def set_table_rows(self, relative: str, headers: list[str], rows: list[list[str]]) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        header = "| " + " | ".join(headers) + " |"
        separator = "| " + " | ".join("---" for _ in headers) + " |"
        marker = header + "\n" + separator + "\n"
        start = text.index(marker) + len(marker)
        end = text.find("\n", start)
        replacement = "\n".join("| " + " | ".join(row) + " |" for row in rows)
        path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")

    def replace_pseudocode_placeholder(self, text: str, branch: str = "B01-01") -> str:
        return text.replace(
            "```text\n已确认并绑定项目证据\n```",
            f"```text\nfunction execute(input):\n    REQUIRE validate(input)  // {branch}\n    RETURN persisted_result\n```",
        )

    def python_module_command(self, module: str) -> str:
        """生成会被 Goal 在当前平台 shell 中实际执行的 Python 命令。"""
        if os.name == "nt":
            return f'& "{PYTHON}" -m {module}'
        return f'"{PYTHON}" -m {module}'

    def complete_for_release(self) -> None:
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli(
            "new-feature",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "创建订单",
            "--domain",
            "订单",
            vendored=True,
        )
        self.run_cli(
            "new-e2e",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "用户创建订单",
            "--requirements",
            "DOP-FR-001",
            "--environment-level",
            "staging",
            vendored=True,
        )
        profile = json.loads((self.root / ".daoge-docs/assets/profiles.json").read_text(encoding="utf-8"))
        for item in profile["documents"]:
            if item.get("gate") not in {"discovery", "version-ready", "release"} or item.get("generated"):
                continue
            relative = item["path"].replace("{{VERSION}}", "V1").replace("{{PROJECT_NAME}}", "确定性订单平台")
            path = self.root / "docs" / relative
            if path.suffix != ".md":
                continue
            text = path.read_text(encoding="utf-8")
            text = re.sub(r"^status:\s*\S+", "status: staging_verified", text, count=1, flags=re.MULTILINE)
            text = re.sub(r"\[待(?:填写|确认|补充|决定|验证)[^\]]*\]", "已确认并绑定项目证据", text)
            text = text.replace("- [ ]", "- [x]").replace("TODO", "已完成").replace("TBD", "已确认")
            path.write_text(text, encoding="utf-8")

        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [["V1", "完成订单闭环", "current", "基础仓库", "当前版本 AC 全部通过", "当前版本/V1-版本总览.md"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["里程碑 ID", "能力主线", "版本/阶段", "用户可感知变化", "依赖与边界", "完成判定", "状态与来源"],
            [["MS-V1-ORDER", "TRACK-ORDER · 订单履约", "V1", "用户可以创建订单", "订单服务与数据库", "订单 AC 全部通过", "current；DOP-FR-001"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["关系 ID", "关系类型", "来源版本/里程碑", "目标版本/里程碑", "影响与处理", "状态与来源"],
            [["ER-NONE", "none", "none", "none", "当前没有兼容、迁移、废弃或替代关系", "current"]],
        )

        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        text = feature.read_text(encoding="utf-8")
        text = re.sub(r"^status:\s*\S+", "status: staging_verified", text, count=1, flags=re.MULTILINE)
        text = re.sub(r"\[待(?:填写|确认|补充|决定|验证)[^\]]*\]", "已确认并绑定项目证据", text)
        text = text.replace("planned", "docs/evidence/passed.json").replace("not_run", "passed").replace("- [ ]", "- [x]")
        text = self.replace_pseudocode_placeholder(text)
        feature.write_text(text, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)

    def complete_for_goal(self) -> None:
        self.complete_for_release()
        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        text = feature.read_text(encoding="utf-8")
        verification_command = self.python_module_command("unittest tests.orders.test_create_order")
        text = re.sub(
            r"^\| AC01 \|.*$",
            lambda _: f"| AC01 | 用户已登录 | 提交合法订单 | 订单持久化并返回稳定 ID | Integration | tests/orders/test_create_order.py | {verification_command} | docs/evidence/passed.json |",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        text = re.sub(r"^\| 后端 \|.*$", "| 后端 | src/orders/service.py | 执行业务规则和事务 |", text, count=1, flags=re.MULTILINE)
        text = re.sub(r"^\| 前端 \|.*$", "| 前端 | app/orders/page.tsx | 提交订单并显示确定结果 |", text, count=1, flags=re.MULTILINE)
        text = re.sub(r"^\| 测试 \|.*$", "| 测试 | tests/orders/test_create_order.py | 验证 AC01 与稳定分支 |", text, count=1, flags=re.MULTILINE)
        feature.write_text(text, encoding="utf-8")
        for relative, content in [
            ("src/orders/service.py", "def create_order():\n    return 'order-001'\n"),
            ("app/orders/page.tsx", "export const OrderPage = () => null;\n"),
            ("tests/orders/test_create_order.py", "import unittest\n\nclass OrderTest(unittest.TestCase):\n    def test_create(self):\n        self.assertTrue(True)\n"),
        ]:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        self.commit_all("prepare deterministic goal baseline")

    def create_passing_evidence(self) -> dict[str, Path]:
        for evidence_type, environment in [
            ("development", "local"),
            ("e2e", "staging"),
            ("performance", "staging"),
            ("release", "production-gate"),
        ]:
            self.run_cli(
                "new-evidence",
                "--root",
                ".",
                "--type",
                evidence_type,
                "--environment",
                environment,
                "--commit",
                "0123456789abcdef",
                "--build-id",
                "build-001",
                vendored=True,
            )
        selector = json.loads((self.root / ".daoge-docs/evidence.json").read_text(encoding="utf-8"))
        paths = {key: self.root / value for key, value in selector["selected"].items()}
        authority = json.loads(self.run_cli("authority-digest", "--root", ".", vendored=True).stdout)["权威文档摘要"]
        base = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=10)
        times = {
            "development": base,
            "e2e": base + timedelta(minutes=1),
            "performance": base + timedelta(minutes=2),
            "release": base + timedelta(minutes=3),
        }
        digest = "sha256:" + "a" * 64
        for evidence_type, path in paths.items():
            report = json.loads(path.read_text(encoding="utf-8"))
            report["executed_at"] = times[evidence_type].isoformat().replace("+00:00", "Z")
            report["result"] = "passed"
            report["commands"] = [{"command": f"verify-{evidence_type}", "exit_code": 0, "output_digest": digest}]
            report["checks"] = [{"id": f"{evidence_type}-summary", "result": "passed", "evidence": "logs/summary.txt"}]
            report["artifacts"] = ["logs/summary.txt"]
            if evidence_type == "development":
                report["checks"] = [
                    {"id": check_id, "result": "passed", "evidence": f"logs/{check_id}.txt"}
                    for check_id in ["build", "static", "unit", "integration"]
                ]
                report["details"] = {
                    "clean_checkout": True,
                    "dependency_mode": "locked-and-containerized",
                    "services": ["database"],
                    "required_checks": ["build", "static", "unit", "integration"],
                }
            elif evidence_type == "e2e":
                report["details"] = {
                    "dependency_mode": "staging-real-services",
                    "required_case_ids": ["E2E-001"],
                    "cases": [{"id": "E2E-001", "result": "passed", "evidence": "artifacts/e2e-001.zip"}],
                }
            elif evidence_type == "performance":
                report["details"] = {
                    "load_profile_id": "LOAD-V1-001",
                    "load_profile_digest": digest,
                    "approved_by": "性能负责人",
                    "approved_at": (base + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
                    "scenarios": [
                        {
                            "id": "PERF-001",
                            "metric": "p95_latency",
                            "operator": "lte",
                            "threshold": 300,
                            "actual": 240,
                            "unit": "ms",
                            "result": "passed",
                            "evidence": "artifacts/perf-001.json",
                        }
                    ],
                }
            else:
                operation = lambda name: {"status": "passed", "evidence": f"artifacts/{name}.txt", "reason": None}
                report["details"] = {
                    "artifact_digest": "sha256:" + "b" * 64,
                    "e2e_report": selector["selected"]["e2e"],
                    "performance_report": selector["selected"]["performance"],
                    "migration": operation("migration"),
                    "backup": operation("backup"),
                    "recovery": operation("recovery"),
                    "security": operation("security"),
                    "smoke": operation("smoke"),
                    "observation": operation("observation"),
                    "rollback": operation("rollback"),
                }
                report["approval"] = {
                    "proposal_id": "REL-V1-001",
                    "confirmed_by": "发布负责人",
                    "confirmed_at": (base + timedelta(minutes=4)).isoformat().replace("+00:00", "Z"),
                    "authority_digest": authority,
                }
            self.write_json(path, report)
        self.run_cli("index", "--root", ".", vendored=True)
        return paths

    def test_strict_init_and_negative_gates(self) -> None:
        self.init()
        self.assertGreaterEqual(len(list((self.root / "docs").rglob("*.*"))), 70)
        template_markers = {
            "docs/02-产品与版本/版本进入开发门禁.md": ["## 门禁输入", "需求 ID -> 函数契约 -> 分支 ID -> AC -> Integration/E2E -> 证据"],
            "docs/05-测试与发布/测试策略.md": ["## 测试分层", "environment_failed", "development、e2e、performance、release"],
            "docs/05-测试与发布/端到端验收/执行手册.md": ["Arrange：", "Assert side effects：", "## 证据保存"],
            "docs/05-测试与发布/性能与容量/V1-性能与容量验收规范.md": ["逐请求定义", "禁止使用 `p95(client) - p95(upstream)`", "## 正确性与通过规则"],
            "docs/05-测试与发布/发布/部署手册.md": ["不可变 build_id", "## 冒烟验证", "## 观察窗口"],
            "docs/05-测试与发布/发布/回滚手册.md": ["## 数据兼容", "## 外部副作用与未知结果"],
            "docs/05-测试与发布/发布/恢复手册.md": ["RPO", "RTO", "## 一致性校验"],
        }
        for relative, markers in template_markers.items():
            content = (self.root / relative).read_text(encoding="utf-8")
            for marker in markers:
                self.assertIn(marker, content, msg=f"{relative} 缺少 {marker}")
        report = json.loads(self.run_cli("check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(report["通过"])
        discovery = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "discovery", "--json", expected=1, vendored=True).stdout
        )
        self.assertFalse(discovery["通过"])
        self.assertTrue(any("待决占位" in item for item in discovery["错误"]))
        release = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertFalse(release["通过"])
        self.assertTrue(any("证据" in item or "当前版本没有功能规格" in item for item in release["错误"]))

    def test_design_and_specialized_contract_failures_are_enforced(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", vendored=True)
        self.run_cli(
            "new-feature",
            "--root",
            ".",
            "--number",
            "2",
            "--name",
            "确认订单",
            "--domain",
            "订单",
            "--risk",
            "high",
            "--risk-reason",
            "并发状态与外部副作用",
            vendored=True,
        )
        high_design = self.root / "docs/03-功能规格/V1/订单/02-确认订单-技术设计.md"
        high_text = high_design.read_text(encoding="utf-8")
        for marker in ["### 函数/用例签名", "## 4. 事务、并发与幂等", "### 伪代码", "B02-04", "## 8. 分支追踪"]:
            self.assertIn(marker, high_text)

        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        text = feature.read_text(encoding="utf-8").replace("status: draft", "status: ready")
        text = re.sub(r"\[待(?:填写|确认|补充|决定|验证)[^\]]*\]", "已确认并绑定项目证据", text)
        feature.write_text(text, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        failed_gate = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "feature-ready", "--feature", "DOP-FR-001", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("伪代码尚未形成可执行语义" in error for error in failed_gate["错误"]))

        performance = self.root / "docs/05-测试与发布/性能与容量/V1-性能与容量验收规范.md"
        original_performance = performance.read_text(encoding="utf-8")
        performance.write_text(original_performance.replace("禁止使用 `p95(client) - p95(upstream)`", "允许聚合分位数直接相减"), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        failed_check = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(any("性能验收规范缺少逐请求口径契约" in error for error in failed_check["错误"]))

        performance.write_text(original_performance, encoding="utf-8")
        e2e_runbook = self.root / "docs/05-测试与发布/端到端验收/执行手册.md"
        e2e_runbook.write_text(e2e_runbook.read_text(encoding="utf-8").replace("Assert side effects：", "只检查响应："), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        failed_check = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(any("E2E 执行手册缺少统一步骤契约" in error for error in failed_check["错误"]))

    def test_generators_traceability_and_positive_feature_gate(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "身份与权限", vendored=True)
        self.run_cli(
            "new-requirement",
            "--root",
            ".",
            "--type",
            "NFR",
            "--name",
            "登录接口延迟",
            "--source",
            "docs/02-产品与版本/当前版本/V1-产品需求.md",
            "--verification",
            "性能场景 PERF-001",
            vendored=True,
        )
        self.run_cli(
            "new-feature",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "用户登录",
            "--domain",
            "身份与权限",
            "--risk",
            "high",
            "--risk-reason",
            "凭证与会话权限边界",
            "--requirements",
            "DOP-NFR-001",
            vendored=True,
        )
        self.run_cli(
            "new-e2e",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "用户成功登录",
            "--requirements",
            "DOP-FR-001,DOP-NFR-001",
            vendored=True,
        )
        self.run_cli(
            "new-decision",
            "--root",
            ".",
            "--title",
            "会话时长",
            "--decision",
            "访问令牌有效期固定为三十分钟",
            "--rationale",
            "限制泄露窗口并满足当前交互",
            "--requirements",
            "DOP-FR-001",
            "--affected",
            "登录、续期、退出",
            "--status",
            "accepted",
            "--confirmed-by",
            "产品负责人",
            vendored=True,
        )
        self.run_cli("new-adr", "--root", ".", "--title", "令牌签名算法", "--requirements", "DOP-FR-001", vendored=True)
        self.run_cli("new-task", "--root", ".", "--feature", "DOP-FR-001", "--name", "实现登录主流程", vendored=True)

        feature = self.root / "docs/03-功能规格/V1/身份与权限/01-用户登录.md"
        design = self.root / "docs/03-功能规格/V1/身份与权限/01-用户登录-技术设计.md"
        for path in [feature, design]:
            text = path.read_text(encoding="utf-8").replace("status: draft", "status: ready")
            text = re.sub(r"\[待填写[^\]]*\]", "已确认并绑定项目证据", text)
            text = self.replace_pseudocode_placeholder(text)
            path.write_text(text, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        self.run_cli("check", "--root", ".", "--json", vendored=True)
        gate = json.loads(
            self.run_cli(
                "gate",
                "--root",
                ".",
                "--stage",
                "feature-ready",
                "--feature",
                "DOP-FR-001",
                "--json",
                vendored=True,
            ).stdout
        )
        self.assertTrue(gate["通过"])
        trace = (self.root / "docs/03-功能规格/V1/00-V1需求追踪矩阵.md").read_text(encoding="utf-8")
        self.assertIn("DOP-NFR-001", trace)
        self.assertIn("AC01", trace)
        decisions = (self.root / "docs/06-决策记录/V1-冻结决策.md").read_text(encoding="utf-8")
        self.assertIn("D001", decisions)
        self.assertIn("产品负责人", decisions)

    def test_profile_depth_and_merge_preserves_content(self) -> None:
        lean_root = self.root / "lean"
        lean_root.mkdir()
        strict_root = self.root / "strict"
        strict_root.mkdir()
        for target, profile in [(lean_root, "lean"), (strict_root, "strict")]:
            result = subprocess.run(
                [
                    PYTHON,
                    str(SCRIPT),
                    "init",
                    "--root",
                    str(target),
                    "--project-name",
                    "示例项目",
                    "--project-code",
                    "EX",
                    "--profile",
                    profile,
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stderr)
        self.assertGreater(len(list((strict_root / "docs").rglob("*.*"))), len(list((lean_root / "docs").rglob("*.*"))))

        merge_root = self.root / "merge"
        (merge_root / "docs").mkdir(parents=True)
        custom = "# 用户已有文档\n"
        (merge_root / "docs/README.md").write_text(custom, encoding="utf-8")
        result = subprocess.run(
            [
                PYTHON,
                str(SCRIPT),
                "init",
                "--root",
                str(merge_root),
                "--project-name",
                "合并项目",
                "--project-code",
                "MG",
                "--profile",
                "strict",
                "--merge",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(custom, (merge_root / "docs/README.md").read_text(encoding="utf-8"))

    def test_doctor_reports_runtime_and_stack_candidates_without_execution(self) -> None:
        (self.root / "package.json").write_text('{"scripts":{"test":"exit 99"}}\n', encoding="utf-8")
        (self.root / "pnpm-workspace.yaml").write_text("packages:\n  - packages/*\n", encoding="utf-8")
        (self.root / "pyproject.toml").write_text("[project]\nname = 'example'\n", encoding="utf-8")
        report = json.loads(self.run_cli("doctor", "--root", ".", "--json").stdout)
        self.assertTrue(report["通过"], report)
        self.assertFalse(report["项目"]["initialized"])
        adapters = {item["id"]: item for item in report["技术栈候选"]}
        self.assertEqual(["package.json", "pnpm-workspace.yaml"], adapters["node"]["evidence"])
        self.assertIn("python", adapters)
        self.assertIn("monorepo", adapters)
        self.assertIn("pnpm test", adapters["node"]["suggested_commands"])
        self.init()
        initialized = json.loads(self.run_cli("doctor", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(initialized["项目"]["initialized"])
        self.assertEqual("docs", initialized["项目"]["docs_root"])

    def test_cli_forces_utf8_when_parent_default_encoding_is_not_unicode_safe(self) -> None:
        environment = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        result = subprocess.run(
            [PYTHON, str(SCRIPT), "doctor", "--root", ".", "--json"],
            cwd=self.root,
            text=True,
            encoding="utf-8",
            capture_output=True,
            env=environment,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("daoge-docs-doctor", json.loads(result.stdout)["诊断"])

    def test_doctor_recognizes_linked_git_worktree(self) -> None:
        self.git("init", "-q")
        self.git("config", "user.name", "DAOGE Docs Test")
        self.git("config", "user.email", "daoge-docs@example.invalid")
        (self.root / "README.md").write_text("# 基线\n", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        linked = self.root.parent / f"{self.root.name}-linked"
        self.git("worktree", "add", "-q", str(linked), "-b", "linked")
        try:
            report = json.loads(self.run_cli("doctor", "--root", str(linked), "--json").stdout)
            self.assertTrue(report["项目"]["git_worktree"])
        finally:
            self.git("worktree", "remove", "--force", str(linked))

    def test_stack_adapter_contract_covers_supported_fixture_markers(self) -> None:
        markers = {
            "go.mod": "go",
            "Cargo.toml": "rust",
            "pom.xml": "java-maven",
            "build.gradle.kts": "java-gradle",
            "sample.sln": "dotnet",
            "Gemfile": "ruby",
            "composer.json": "php",
            "nx.json": "monorepo",
        }
        for filename, expected_adapter in markers.items():
            path = self.root / filename
            path.write_text("fixture\n", encoding="utf-8")
            adapters = {item["id"]: item for item in json.loads(self.run_cli("doctor", "--root", ".", "--json").stdout)["技术栈候选"]}
            self.assertIn(expected_adapter, adapters, filename)
            self.assertEqual(1, adapters[expected_adapter]["contract_version"])

    def test_ci_check_regenerates_and_checks_initialized_project(self) -> None:
        self.init()
        report = json.loads(self.run_cli("ci-check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(report["通过"], report)
        self.assertTrue(report["派生文件"])
        self.assertTrue(report["工作台 Smoke 资源"])
        self.assertTrue(report["警告"])

    def test_reference_depth_generators_and_section_enforcement(self) -> None:
        self.init()
        commands = [
            ("new-future-version", "--root", ".", "--version", "V2", "--name", "稳定性增强"),
            ("new-domain", "--root", ".", "--name", "订单"),
            ("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单"),
            ("new-e2e", "--root", ".", "--number", "1", "--name", "用户创建订单", "--requirements", "DOP-FR-001"),
            ("new-decision", "--root", ".", "--title", "订单号格式", "--decision", "订单号使用不可变随机标识", "--rationale", "避免暴露业务规模", "--requirements", "DOP-FR-001", "--affected", "订单与审计", "--status", "accepted", "--confirmed-by", "产品负责人"),
            ("new-architecture-spec", "--root", ".", "--name", "订单生命周期", "--key", "ORDER", "--kind", "lifecycle", "--with-example"),
            ("new-reference", "--root", ".", "--name", "支付渠道调研", "--source-date", "2026-08-01", "--review-after", "2026-11-01"),
            ("archive", "--root", ".", "--name", "旧订单方案", "--source", "legacy/order.md", "--replacement", "docs/03-功能规格/V1/订单/01-创建订单.md", "--reason", "旧方案已由稳定功能规格替代"),
        ]
        for command in commands:
            self.run_cli(*command, vendored=True)
        for evidence_type, environment in [
            ("development", "local"),
            ("e2e", "staging"),
            ("performance", "staging"),
            ("release", "production-gate"),
        ]:
            self.run_cli(
                "new-evidence",
                "--root",
                ".",
                "--type",
                evidence_type,
                "--environment",
                environment,
                "--commit",
                "0123456789abcdef",
                "--build-id",
                "build-001",
                vendored=True,
            )
        self.run_cli("check", "--root", ".", "--json", vendored=True)
        audit = json.loads(self.run_cli("audit", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(audit["达到参考 docs 的能力深度"])
        self.assertTrue((self.root / "docs/02-产品与版本/图表/功能演进-版本主链路.svg").exists())
        self.assertTrue((self.root / "docs/90-参考资料/产品文档浏览器.html").exists())
        self.assertTrue((self.root / "docs/05-测试与发布/端到端验收/报告").exists())
        browser_html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        for marker in [
            'data-view="workbench"',
            'data-view="overview"',
            'data-view="reader"',
            'data-view="map"',
            'data-view="evolution"',
            'data-view="timeline"',
            "function renderMarkdown",
            "function collectMarkdownReferences",
            "function parseMarkdownList",
            "function markdownTableCells",
            "function markdownLink",
            "let codeSpan = false;",
            "char.charCodeAt(0) === 92",
            "function renderSearch",
            "function renderArchitectureOverview",
            "function orderedGraphNodes",
            "function renderProductArchitectureMap",
            "function renderCoreFlowMap",
            "function renderVersionRoadmapMap",
            "function renderDataDomainsMap",
            "function renderDeliveryTraceMap",
            "function renderRiskHotspotsMap",
            "function renderEvolution",
            "evolution-matrix",
            "function sourceAttributes",
            'has_acceptance:"具备验收"',
            'implemented_by:"由任务实现"',
            "function renderVerificationPanel",
            "function renderChangeSummary",
            "当前交付进度",
            "点击步骤返回权威来源",
            'class="architecture-lanes"',
            'class="overview-flow-grid"',
            'aria-label="关闭文档目录"',
            'aria-label="关闭阅读辅助"',
            "input.setSelectionRange",
            ".article th, .article td { min-width: 104px; }",
            ".map-flow { display: grid; gap: 0; overflow: visible; padding-bottom: 0; }",
            "catch { if (location.hash !== hash) location.hash = hash; }",
            'view === "governance"',
            'view === "diff"',
            'state.panel = "verification"',
            'state.panel = "changes"',
            "overflow-x: auto; overflow-y: hidden; scrollbar-width: thin;",
            ".segmented button { flex: 0 0 auto; min-width: 70px; padding: 0 9px; font-size: 12px; }",
            "function readerHref",
            "function documentMatchLocation",
            "function restoreReaderPosition",
            "function readerPositionKey",
            "function readerContext",
            "function goalPreparationPrompt",
            'data-copy-feature',
            'data-copy-goal-prompt',
            "复制 Goal 提示",
            "prepare-goal --root . --version",
            "开始实现前等待我的确认",
            "打开 Markdown 原文",
            "download>下载 Markdown",
            "section:params.get",
            "map:params.get",
            "data-open-section",
            "function revealActiveTab",
        ]:
            self.assertIn(marker, browser_html)
        for obsolete in ['data-view="governance"', 'data-view="diff"', "个人工作视图", "data-personal-filter", "daoge-docs.recentDocs", "data-toggle-favorite", ".segmented button { padding: 0 2px; font-size: 10px; }"]:
            self.assertNotIn(obsolete, browser_html)
        self.assertGreater(browser_html.rfind("\n    init();"), browser_html.find("const MAP_META"))
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        self.assertEqual(8, payload["schema_version"])
        for key in ["generated_at", "tool_version", "authority_digest", "directories", "entities", "relations", "findings", "task_packets", "snapshots", "views", "change_summary", "goal_readiness", "workbench"]:
            self.assertIn(key, payload)
        self.assertTrue(payload["directories"])
        self.assertTrue(payload["task_packets"])
        self.assertTrue(all("source_path" in item and "recovery_action" in item for item in payload["findings"]))
        self.assertEqual("DOP-FR-001", payload["features"][0]["id"])
        self.assertTrue(any("创建订单" in item["content"] for item in payload["documents"]))
        feature_document = next(
            item
            for item in payload["documents"]
            if item["path"] == "03-功能规格/V1/订单/01-创建订单.md"
        )
        self.assertRegex(feature_document["content_digest"], r"^sha256:[0-9a-f]{64}$")
        self.assertTrue(feature_document["sections"])
        self.assertTrue(any(item["title"] == "功能卡" for item in feature_document["sections"]))
        self.assertGreaterEqual(feature_document["sections"][0]["line_start"], 1)
        self.assertEqual(len(feature_document["sections"]), len({item["id"] for item in feature_document["sections"]}))
        self.assertEqual(4, len(payload["governance"]["gates"]))
        self.assertEqual(7, len(payload["governance"]["testing"]))
        self.assertIn("design_depth", payload["governance"])
        self.assertEqual(
            {"product_architecture", "core_flow", "version_roadmap", "data_domains", "delivery_trace", "risk_hotspots"},
            set(payload["views"]["maps"]),
        )
        self.assertEqual(
            {"workbench", "overview", "reader", "maps", "evolution", "timelines"},
            set(payload["views"]),
        )
        overview = payload["views"]["overview"]
        self.assertEqual(
            {"scope", "stats", "product_architecture", "core_flow", "version_chain", "development_progress", "accepted_decisions", "authority_entries"},
            set(overview),
        )
        progress = overview["development_progress"]
        self.assertEqual(
            {"not_started", "implementing", "local_verified", "staging_verified", "released", "unknown"},
            set(progress["counts"]),
        )
        self.assertEqual(len(payload["features"]), sum(progress["counts"].values()))
        self.assertEqual(len(payload["features"]), len(progress["items"]))
        self.assertTrue(all(item["basis"] and len(item["sources"]) == 2 for item in progress["items"]))
        self.assertNotIn("draft", progress["counts"])
        self.assertTrue(all(node["sources"] for node in overview["product_architecture"]["nodes"]))
        self.assertTrue(all(node["sources"] for node in overview["core_flow"]["nodes"]))
        self.assertTrue(all(node["sources"] for node in overview["version_chain"]["nodes"]))
        self.assertLessEqual(len(payload["views"]["workbench"]["top_blockers"]), 3)
        self.assertEqual("V1", payload["views"]["workbench"]["active_execution_version"])
        self.assertEqual(["project", "version", "path"], [item["id"] for item in payload["views"]["reader"]["navigation"]["modes"]])
        self.assertFalse(payload["change_summary"]["available"])

        blueprint = self.root / "docs/02-产品与版本/产品蓝图.md"
        text = blueprint.read_text(encoding="utf-8").replace(". 产品概述", ". 已删除章节", 1)
        blueprint.write_text(text, encoding="utf-8")
        failed = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(any("产品概述" in error for error in failed["错误"]))

    def test_overview_delivery_progress_uses_engineering_signals(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli(
            "new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", vendored=True
        )
        feature_path = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        feature_path.write_text(feature_path.read_text(encoding="utf-8") + "\n工程落点：`backend/src/orders.py`\n", encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)

        def overview_progress() -> dict:
            browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
            payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
            return payload["views"]["overview"]["development_progress"]

        before = overview_progress()
        self.assertEqual(1, before["counts"]["not_started"])
        self.assertEqual("not_started", before["items"][0]["status"])

        implementation_path = self.root / "backend/src/orders.py"
        implementation_path.parent.mkdir(parents=True)
        implementation_path.write_text("def create_order():\n    return None\n", encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        after = overview_progress()
        self.assertEqual(1, after["counts"]["implementing"])
        self.assertEqual(0, after["counts"]["not_started"])
        self.assertEqual("implementing", after["items"][0]["status"])
        self.assertIn("已存在工程落点", after["items"][0]["basis"])

    def test_workbench_development_readiness_excludes_release_blockers(self) -> None:
        self.init()
        self.complete_for_goal()
        checklist = self.root / "docs/05-测试与发布/发布/检查清单.md"
        text = checklist.read_text(encoding="utf-8")
        checklist.write_text(re.sub(r"^status:\s*\S+", "status: ready", text, count=1, flags=re.MULTILINE), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        payload = self.browser_payload()
        release_gate = next(item for item in payload["governance"]["gates"] if item["id"] == "release")
        self.assertEqual("blocked", release_gate["status"])
        self.assertTrue(release_gate["blocking_signals"])
        self.assertEqual("ready", payload["goal_readiness"]["status"])
        self.assertEqual("ready", payload["workbench"]["decision"]["status"])
        self.assertEqual("feature-ready", payload["workbench"]["context"]["stage"])
        self.assertEqual([], payload["workbench"]["top_blockers"])

    def test_audit_accepts_v1_only_future_version_planning_space(self) -> None:
        self.init()
        self.complete_for_release()
        audit = json.loads(self.run_cli("audit", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(audit["能力"]["版本演进规划"])
        self.assertEqual([], [path for path in (self.root / "docs/02-产品与版本/后续版本").glob("*.md") if path.name != "README.md"])

    def test_v2_does_not_treat_frozen_v1_e2e_requirements_as_current(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli("new-version", "--root", ".", "--version", "V2", vendored=True)
        report = json.loads(self.run_cli("check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(report["通过"], report)
        matrix = (self.root / "docs/05-测试与发布/端到端验收/用例矩阵.md").read_text(encoding="utf-8")
        self.assertNotIn("E2E-001", matrix)
        self.assertNotIn("E2E-002", matrix)

    def test_cross_version_portfolio_preserves_active_execution_context(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli(
            "new-decision",
            "--root", ".",
            "--title", "订单数据保留",
            "--decision", "订单记录保留在本地文件中",
            "--rationale", "支持离线任务闭环",
            "--requirements", "DOP-FR-001",
            "--affected", "订单数据",
            "--status", "accepted",
            "--confirmed-by", "产品负责人",
            vendored=True,
        )
        self.run_cli("new-version", "--root", ".", "--version", "V2", vendored=True)
        self.run_cli("new-domain", "--root", ".", "--name", "支付", vendored=True)
        self.run_cli(
            "new-feature", "--root", ".", "--number", "2", "--name", "支付订单", "--domain", "支付", vendored=True
        )
        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [
                ["V1", "订单基线", "ready（规格）", "基础仓库", "V1 AC", "当前版本/V1-版本总览.md"],
                ["V2", "支付扩展", "ready（规格）", "V1 订单语义", "V2 AC", "当前版本/V2-版本总览.md"],
            ],
        )
        self.run_cli("index", "--root", ".", vendored=True)
        payload = self.browser_payload()
        workbench = payload["views"]["workbench"]
        portfolio = workbench["version_portfolio"]
        self.assertEqual("V2", workbench["active_execution_version"])
        self.assertEqual("V2", portfolio["active_execution_version"])
        self.assertEqual(["V1", "V2"], [item["id"] for item in portfolio["versions"]])
        self.assertEqual(["all", "V1", "V2"], [item["id"] for item in portfolio["browsing_scopes"]])
        v1 = next(item for item in portfolio["versions"] if item["id"] == "V1")
        v2 = next(item for item in portfolio["versions"] if item["id"] == "V2")
        self.assertEqual({"DOP-FR-001"}, {item["id"] for item in v1["features"]})
        self.assertTrue(all(item["verification"] == "unknown" for item in v1["features"]))
        self.assertEqual({"DOP-FR-002"}, {item["id"] for item in payload["features"]})
        self.assertEqual({"DOP-FR-002"}, {item["feature_id"] for item in payload["task_packets"]})
        self.assertEqual({"DOP-FR-001", "DOP-FR-002"}, {item["id"] for item in payload["project_features"]})
        self.assertEqual({"DOP-FR-001", "DOP-FR-002"}, {item["feature_id"] for item in payload["views"]["timelines"]})
        overview = payload["views"]["overview"]
        self.assertEqual({"label": "全版本", "active_execution_version": "V2"}, overview["scope"])
        self.assertEqual(2, overview["stats"]["versions"])
        self.assertEqual(2, overview["stats"]["features"])
        self.assertEqual(2, overview["stats"]["requirements"])
        self.assertEqual(1, overview["stats"]["accepted_decisions"])
        self.assertEqual(1, sum(overview["development_progress"]["counts"].values()))
        historical_timeline = next(item for item in payload["views"]["timelines"] if item["feature_id"] == "DOP-FR-001")
        self.assertEqual("V1", historical_timeline["version"])
        self.assertEqual("unknown", historical_timeline["current_gate"])
        self.assertEqual("unknown", historical_timeline["evidence_freshness"])
        self.assertTrue(v2["features"])
        browser_html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        self.assertIn('data-portfolio-feature', browser_html)
        self.assertIn('版本功能', browser_html)
        self.assertIn('workbenchProjectFeature', browser_html)
        self.assertIn('项目功能浏览', browser_html)
        self.assertIn('function featureCatalog', browser_html)
        reader = payload["views"]["reader"]["navigation"]
        version_mode = next(item for item in reader["modes"] if item["id"] == "version")
        groups = {item["id"]: item["document_paths"] for item in version_mode["groups"]}
        self.assertTrue(any("03-功能规格/V1/订单/01-创建订单.md" == path for path in groups["V1"]))
        self.assertTrue(any("03-功能规格/V2/支付/02-支付订单.md" == path for path in groups["V2"]))

    def test_cross_version_features_are_ordered_by_stable_number(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli("new-version", "--root", ".", "--version", "V2", vendored=True)
        self.run_cli("new-domain", "--root", ".", "--name", "支付", vendored=True)
        for number, name in [(10, "统计"), (8, "导出"), (9, "导入")]:
            self.run_cli(
                "new-feature", "--root", ".", "--number", str(number), "--name", name,
                "--domain", "支付", vendored=True,
            )
        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [["V1", "订单基线", "ready（规格）", "基础仓库", "V1 AC", "当前版本/V1-版本总览.md"],
             ["V2", "支付扩展", "ready（规格）", "V1 订单语义", "V2 AC", "当前版本/V2-版本总览.md"]],
        )
        self.run_cli("index", "--root", ".", vendored=True)
        payload = self.browser_payload()
        v2 = next(item for item in payload["views"]["workbench"]["version_portfolio"]["versions"] if item["id"] == "V2")
        self.assertEqual(["DOP-FR-008", "DOP-FR-009", "DOP-FR-010"], [item["id"] for item in v2["features"]])

    def test_browser_document_status_distinguishes_authority_and_derived_inputs(self) -> None:
        self.init()
        ordinary = self.root / "docs/01-项目概览/无生命周期声明.md"
        ordinary.write_text("# 无生命周期声明\n\n这是一份没有 front matter 的普通 Markdown。\n", encoding="utf-8")
        self.run_cli("index", "--root", ".")
        payload = self.browser_payload()
        documents = {item["path"]: item for item in payload["documents"]}

        authority = documents["01-项目概览/项目调研与事实清单.md"]
        generated = documents["03-功能规格/V1/README.md"]
        structured = documents["03-功能规格/V1/00-V1需求注册表.json"]
        unknown = documents["01-项目概览/无生命周期声明.md"]

        self.assertEqual("ready", authority["status"])
        self.assertEqual("frontmatter", authority["status_source"])
        self.assertEqual("generated", generated["status"])
        self.assertEqual("generated_marker", generated["status_source"])
        self.assertTrue(generated["generated"])
        self.assertEqual("not_applicable", structured["status"])
        self.assertEqual("structured_file", structured["status_source"])
        self.assertEqual("unknown", unknown["status"])
        self.assertEqual("missing_frontmatter", unknown["status_source"])

    def test_historical_version_goal_is_explicit_and_does_not_switch_execution_version(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli("new-version", "--root", ".", "--version", "V2", vendored=True)
        self.run_cli("index", "--root", ".", vendored=True)
        self.commit_all("freeze active V2 browsing baseline")

        prepared = json.loads(
            self.run_cli(
                "prepare-goal",
                "--root",
                ".",
                "--version",
                "V1",
                "--feature",
                "DOP-FR-001",
                vendored=True,
            ).stdout
        )
        manifest_path = self.root / prepared["文件"]
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual("V1", manifest["version"])
        self.assertEqual("V2", manifest["current_execution_version"])
        self.assertEqual("V1", prepared["目标版本"])
        self.assertEqual("V2", prepared["当前执行版本"])

        status = json.loads(
            self.run_cli(
                "goal-status",
                "--root",
                ".",
                "--goal",
                manifest["goal_id"],
                "--read-only",
                vendored=True,
            ).stdout
        )
        self.assertNotEqual("stale", status["状态"])
        self.assertEqual("V1", status["目标版本"])
        self.assertEqual("V2", status["当前执行版本"])

        browser = self.browser_payload()
        self.assertEqual("V2", browser["project"]["current_version"])
        self.assertEqual({"DOP-FR-001"}, {item["id"] for item in browser["project_features"] if item["version"] == "V1"})
        html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        self.assertIn("prepare-goal --root . --version", html)
        self.assertIn("data-copy-feature", html)
        self.assertIn("data-copy-goal-prompt", html)

    def test_proposed_feature_adr_blocks_check_gate_and_workbench(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli(
            "new-adr",
            "--root",
            ".",
            "--title",
            "订单文件迁移边界",
            "--requirements",
            "DOP-FR-001",
            vendored=True,
        )
        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        feature.write_text(feature.read_text(encoding="utf-8").replace("decisions: none", "decisions: ADR-0001"), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)

        report = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(any("功能依赖的 ADR 尚未接受：DOP-FR-001 -> ADR-0001：proposed" in error for error in report["错误"]), report)
        gate = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "feature-ready", "--feature", "DOP-FR-001", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("ADR 尚未接受" in error for error in gate["错误"]), gate)
        payload = self.browser_payload()
        self.assertEqual("blocked", payload["workbench"]["decision"]["status"])
        self.assertEqual(["WB-F-0001"], payload["workbench"]["top_blockers"])
        self.assertEqual("blocked", payload["goal_readiness"]["status"])
        self.assertFalse("`" in payload["task_packets"][0]["verification_commands"][0])
        self.assertTrue(
            any("ADR 尚未接受" in finding["reason"] for finding in payload["findings"]),
            payload["findings"],
        )

    def test_check_accepts_browser_data_after_committing_only_derived_files(self) -> None:
        self.init()
        self.commit_all("record initialized documentation")
        self.run_cli("index", "--root", ".", vendored=True)
        generated = [
            path.relative_to(self.root).as_posix()
            for path in (self.root / "docs/90-参考资料").glob("产品文档浏览器-文档数据.js")
        ]
        self.assertEqual(["docs/90-参考资料/产品文档浏览器-文档数据.js"], generated)
        self.git("add", *generated)
        self.git("commit", "-qm", "commit refreshed browser data")
        result = json.loads(self.run_cli("check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(result["通过"], result)

        authority = self.root / "docs/02-产品与版本/产品蓝图.md"
        authority.write_text(authority.read_text(encoding="utf-8") + "\n权威内容已变更。\n", encoding="utf-8")
        stale = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(
            any("产品文档浏览器-文档数据.js" in error for error in stale["错误"]),
            stale,
        )

        authority.write_text(authority.read_text(encoding="utf-8").replace("\n权威内容已变更。\n", "\n"), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        self.git("add", "docs/90-参考资料/产品文档浏览器-文档数据.js")
        self.git("commit", "-qm", "refresh browser data after authority test")
        code_path = self.root / "src/task_cli.py"
        code_path.parent.mkdir(parents=True, exist_ok=True)
        code_path.write_text("def main():\n    return 0\n", encoding="utf-8")
        self.git("add", "src/task_cli.py")
        self.git("commit", "-qm", "add product code")
        code_stale = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(
            any("产品文档浏览器-文档数据.js" in error for error in code_stale["错误"]),
            code_stale,
        )

    def test_utf8_server_and_reader_links_keep_markdown_chinese_readable(self) -> None:
        self.init()
        browser_html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        self.assertIn('href="${escapeHtml(rootHref(doc.path))}"', browser_html)
        self.assertIn('href="${escapeHtml(readerHref(target.path, target.fragment))}"', browser_html)
        self.assertIn('target="_blank" rel="noopener">打开 Markdown 原文</a>', browser_html)
        self.assertIn('download>下载 Markdown</a>', browser_html)
        report = json.loads(self.run_cli("browser-check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(report["通过"], report)
        self.assertTrue(any(path.endswith(".md") for path in report["资源"]))

    def test_reader_renderer_preserves_extended_markdown_semantics(self) -> None:
        self.init()
        source = self.root / "docs/01-项目概览/阅读语义回归.md"
        source.write_text(
            """# 阅读语义回归

###### 六级标题

- [x] 已完成项
- [ ] 待办项
  - 嵌套项
  - [x] 嵌套任务

| 左对齐 | 居中 | 右对齐 | 转义 |
| :--- | :---: | ---: | --- |
| *斜体* | ~~废弃~~ | `a|b` | a\\|b |

[项目说明][project]

[project]: 项目说明.md#目标、范围与非目标
""",
            encoding="utf-8",
        )
        self.run_cli("index", "--root", ".", vendored=True)
        browser_data = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_data.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        document = next(item for item in payload["documents"] if item["path"] == "01-项目概览/阅读语义回归.md")
        self.assertTrue(any(item["title"] == "六级标题" and item["level"] == 6 for item in document["sections"]))
        browser_html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        for marker in [
            "function collectMarkdownReferences",
            "function parseMarkdownList",
            "function markdownTableCells",
            "function markdownLink",
            '<input type="checkbox" disabled',
            "<del>$1</del>",
            '<em>$2</em>',
        ]:
            self.assertIn(marker, browser_html)

    def test_p1_structured_views_have_traceable_graphs(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", "--evolution-track", "TRACK-ORDER", vendored=True)
        self.run_cli("new-e2e", "--root", ".", "--number", "1", "--name", "用户创建订单", "--requirements", "DOP-FR-001", vendored=True)
        self.set_table_rows(
            "docs/02-产品与版本/产品蓝图.md",
            ["稳定 ID", "用户/入口", "核心能力", "所属领域", "目标结果"],
            [["ENTRY-001", "订单控制台", "创建订单", "订单", "获得稳定订单 ID"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/产品蓝图.md",
            ["步骤 ID", "顺序", "参与者", "动作", "系统/领域", "业务结果", "失败结果"],
            [
                ["FLOW-001", "1", "用户", "提交订单", "订单前端", "请求进入订单服务", "显示输入错误"],
                ["FLOW-002", "2", "订单服务", "持久化订单", "订单领域", "返回稳定订单 ID", "事务回滚并返回稳定错误"],
            ],
        )
        self.set_table_rows(
            "docs/02-产品与版本/产品蓝图.md",
            ["风险 ID", "领域/对象", "等级", "原因", "影响", "控制", "验证入口"],
            [["RISK-001", "订单事务", "high", "重复提交", "生成重复订单", "幂等键与唯一约束", "DOP-FR-001:AC01"]],
        )
        self.set_table_rows(
            "docs/04-技术架构/总体架构.md",
            ["组件 ID", "名称", "类型", "职责", "所属领域", "部署单元"],
            [
                ["COMP-WEB", "订单前端", "frontend", "接收用户输入", "订单", "web"],
                ["COMP-ORDER", "订单服务", "backend", "执行业务规则", "订单", "api"],
            ],
        )
        self.set_table_rows(
            "docs/04-技术架构/总体架构.md",
            ["关系 ID", "来源组件", "关系", "目标组件", "契约", "失败语义"],
            [["REL-001", "COMP-WEB", "calls", "COMP-ORDER", "POST /orders", "返回稳定错误码"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [
                ["V1", "完成订单闭环", "current", "基础仓库", "订单 AC 通过", "当前版本/V1-版本总览.md"],
                ["V2", "增强订单查询", "planning", "V1", "查询验收通过", "后续版本/V2-订单查询.md"],
            ],
        )
        self.set_table_rows(
            "docs/04-技术架构/当前版本/V1-数据模型.md",
            ["数据域 ID", "数据/实体", "唯一写入者", "只读使用者", "关系", "不变量"],
            [["DATA-ORDER", "Order", "COMP-ORDER", "COMP-WEB", "订单服务拥有订单", "订单 ID 全局唯一"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["里程碑 ID", "能力主线", "版本/阶段", "用户可感知变化", "依赖与边界", "完成判定", "状态与来源"],
            [
                ["MS-V1-ORDER", "TRACK-ORDER · 订单履约", "V1", "用户可以创建订单", "订单服务与数据库", "DOP-FR-001 AC 全部通过", "current；DOP-FR-001"],
                ["MS-V2-ORDER", "TRACK-ORDER · 订单履约", "V2", "用户可以查询订单", "V1 订单 ID 稳定", "查询功能 AC 全部通过", "planning；V2 路线图"],
            ],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["关系 ID", "关系类型", "来源版本/里程碑", "目标版本/里程碑", "影响与处理", "状态与来源"],
            [["ER-ORDER-001", "migration", "MS-V1-ORDER", "MS-V2-ORDER", "V2 上线后保留 V1 查询兼容期", "planning；V2 路线图"]],
        )
        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        feature_text = feature.read_text(encoding="utf-8")
        verification_command = self.python_module_command("unittest tests.orders.test_create_order")
        feature_text = re.sub(
            r"^\| AC01 \|.*$",
            lambda _: f"| AC01 | 用户已登录 | 提交合法订单 | 订单持久化并返回稳定 ID | Integration | tests/orders/test_create_order.py | {verification_command} | docs/evidence/passed.json |",
            feature_text,
            count=1,
            flags=re.MULTILINE,
        )
        feature_text = re.sub(
            r"^\| B01-01 \|.*$",
            "| B01-01 | AC01 | E2E-001 | Feature Ready |",
            feature_text,
            count=1,
            flags=re.MULTILINE,
        )
        feature.write_text(feature_text, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        browser_html = (self.root / "docs/90-参考资料/产品文档浏览器.html").read_text(encoding="utf-8")
        for marker in [
            "function renderProductArchitectureMap",
            "function renderCoreFlowMap",
            "function renderVersionRoadmapMap",
            "function renderDataDomainsMap",
            "function renderDeliveryTraceMap",
            "function renderRiskHotspotsMap",
        ]:
            self.assertIn(marker, browser_html)
        self.assertIn("function renderFlowRail", browser_html)
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        for model in payload["views"]["maps"].values():
            self.assertEqual("ready", model["status"], model)
            self.assertTrue(model["nodes"])
            node_ids = {item["id"] for item in model["nodes"]}
            self.assertTrue(
                all(item.get("sources") and item["sources"][0].get("source_path") for item in model["nodes"]),
                (model["id"], [item for item in model["nodes"] if not item.get("sources") or not item["sources"][0].get("source_path")]),
            )
            self.assertTrue(all(item.get("sources") and item["sources"][0].get("source_path") for item in model["edges"]))
            self.assertTrue(all(item["from"] in node_ids and item["to"] in node_ids for item in model["edges"]))
        self.assertFalse(any(item["relation"] == "contains" for item in payload["views"]["maps"]["delivery_trace"]["edges"]))
        self.assertEqual(
            {"COMP-ORDER", "COMP-WEB", "DATA-ORDER"},
            {item["id"] for item in payload["views"]["maps"]["data_domains"]["nodes"]},
        )
        risk_node = next(item for item in payload["views"]["maps"]["risk_hotspots"]["nodes"] if item["type"] == "risk")
        self.assertEqual("high", risk_node["severity"])
        feature_node = next(item for item in payload["views"]["maps"]["delivery_trace"]["nodes"] if item["id"] == "DOP-FR-001")
        self.assertEqual("feature", feature_node["type"])
        self.assertEqual("功能卡", feature_node["sources"][0]["source_section"])
        self.assertTrue(all(item.get("planning_status") for item in payload["views"]["maps"]["version_roadmap"]["nodes"]))
        self.assertEqual(1, len(payload["views"]["evolution"]["tracks"]))
        self.assertEqual("ready", payload["views"]["evolution"]["status"])
        self.assertEqual("订单履约", payload["views"]["evolution"]["tracks"][0]["title"])
        self.assertEqual("migration", payload["views"]["evolution"]["relationships"][0]["type"])
        self.assertEqual("基础仓库", payload["views"]["evolution"]["versions"][0]["prerequisites"])
        timeline = payload["views"]["timelines"][0]
        self.assertIn("evidence_freshness", timeline)
        self.assertEqual(2, len(timeline["milestones"]))

    def test_evolution_orders_versions_and_blocks_partial_sources(self) -> None:
        self.init()
        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [
                ["V1", "建立底座", "current", "基础仓库", "底座验收通过", "当前版本/V1-版本总览.md"],
                ["V2", "增强查询", "planning", "V1", "查询验收通过", "后续版本/V2.md"],
                ["V10", "规模化交付", "planning", "V2", "容量验收通过", "后续版本/V10.md"],
            ],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["里程碑 ID", "能力主线", "版本/阶段", "用户可感知变化", "依赖与边界", "完成判定", "状态与来源"],
            [
                ["MS-V10-ORDER", "TRACK-ORDER · 订单履约", "V10", "支持规模化履约", "V2 查询稳定", "容量验收通过", "planning；V10 路线图"],
                ["MS-V2-ORDER", "TRACK-ORDER · 订单履约", "V2", "支持订单查询", "V1 订单稳定", "查询验收通过", "planning；V2 路线图"],
            ],
        )
        self.set_table_rows(
            "docs/02-产品与版本/功能演进矩阵.md",
            ["关系 ID", "关系类型", "来源版本/里程碑", "目标版本/里程碑", "影响与处理", "状态与来源"],
            [["ER-NONE", "none", "none", "none", "当前没有兼容、迁移、废弃或替代关系", "current"]],
        )
        self.run_cli("index", "--root", ".", vendored=True)
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        evolution = payload["views"]["evolution"]
        self.assertEqual("ready", evolution["status"], evolution["findings"])
        self.assertEqual(["V1", "V2", "V10"], [item["id"] for item in evolution["versions"]])
        self.assertEqual(["MS-V2-ORDER", "MS-V10-ORDER"], [item["id"] for item in evolution["milestones"]])
        self.assertFalse(evolution["relationships"])

        matrix = self.root / "docs/02-产品与版本/功能演进矩阵.md"
        matrix.write_text(matrix.read_text(encoding="utf-8").replace("| 关系 ID |", "| 已删除关系 ID |", 1), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        evolution = payload["views"]["evolution"]
        self.assertEqual("blocked", evolution["status"])
        self.assertTrue(any(item["source_section"] == "兼容影响" for item in evolution["findings"]))

    def test_browser_contract_requires_each_feature_track_to_have_a_milestone(self) -> None:
        """A timeline cannot claim an evolution track that the matrix omits."""
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli(
            "new-feature",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "创建订单",
            "--domain",
            "订单",
            "--evolution-track",
            "TRACK-MISSING",
            vendored=True,
        )
        self.run_cli("index", "--root", ".", vendored=True)
        result = json.loads(
            self.run_cli("browser-check", "--root", ".", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("功能引用了未登记的能力主线：TRACK-MISSING" in error for error in result["错误"]))

    def test_evolution_status_distinguishes_baseline_and_active_versions(self) -> None:
        module = load_cli_module()
        self.assertEqual("baseline", module.evolution_planning_status("baseline；V1 版本总览"))
        self.assertEqual("active", module.evolution_planning_status("active；V2 版本总览"))
        self.assertEqual("planning", module.evolution_planning_status("planning；V3 版本总览"))
        self.assertEqual("planning", module.evolution_planning_status("planning；未完成任务的查询"))
        self.assertEqual("completed", module.evolution_planning_status("已完成；开发级证据"))
        html = (SCRIPT.parent / "assets/templates/browser/产品文档浏览器.html").read_text(encoding="utf-8")
        self.assertIn('baseline:"基线版本"', html)
        self.assertIn('active:"当前执行"', html)
        self.assertIn("浏览任意版本功能不会改变当前执行版本", html)

    def test_map_readiness_blocks_partial_sources_and_does_not_guess_version_edges(self) -> None:
        self.init()
        self.set_table_rows(
            "docs/02-产品与版本/产品蓝图.md",
            ["稳定 ID", "用户/入口", "核心能力", "所属领域", "目标结果"],
            [["ENTRY-001", "订单控制台", "创建订单", "订单", "获得稳定订单 ID"]],
        )
        self.set_table_rows(
            "docs/02-产品与版本/版本路线图.md",
            ["版本 ID", "目标", "状态", "前置版本/能力", "退出条件", "权威文档"],
            [
                ["V1", "完成订单闭环", "current", "基础仓库", "订单 AC 通过", "当前版本/V1-版本总览.md"],
                ["V2", "增强订单查询", "planning", "共享身份能力", "查询验收通过", "后续版本/V2-订单查询.md"],
            ],
        )
        self.run_cli("index", "--root", ".", vendored=True)
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_js.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        product = payload["views"]["maps"]["product_architecture"]
        roadmap = payload["views"]["maps"]["version_roadmap"]
        self.assertEqual("blocked", product["status"])
        self.assertTrue(product["nodes"])
        self.assertTrue(product["findings"])
        self.assertEqual("ready", roadmap["status"])
        self.assertEqual([], roadmap["edges"])
        result = json.loads(self.run_cli("browser-check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(result["通过"], result)

    def test_p1_goal_is_deterministic_and_detects_stale_or_tamper(self) -> None:
        self.init()
        self.complete_for_goal()
        first = json.loads(self.run_cli("prepare-goal", "--root", ".", "--feature", "DOP-FR-001", "--goal-id", "GOAL-V1-101", vendored=True).stdout)
        second = json.loads(self.run_cli("prepare-goal", "--root", ".", "--feature", "DOP-FR-001", "--goal-id", "GOAL-V1-102", vendored=True).stdout)
        self.assertEqual("ready", first["状态"], first)
        second_manifest = json.loads((self.root / ".daoge-docs/goals/GOAL-V1-102/goal-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual("ready", second["状态"], second_manifest["blocking_findings"])
        manifests = []
        for goal_id in ["GOAL-V1-101", "GOAL-V1-102"]:
            path = self.root / ".daoge-docs/goals" / goal_id / "goal-manifest.json"
            manifest = json.loads(path.read_text(encoding="utf-8"))
            manifests.append(manifest)
            self.assertTrue(manifest["source_commit"])
            self.assertTrue(manifest["authority_digest"].startswith("sha256:"))
            self.assertTrue(manifest["allowed_paths"])
            self.assertTrue(manifest["ordered_tasks"][0]["acceptance_ids"])
            self.assertTrue(manifest["ordered_tasks"][0]["branch_ids"])
            self.assertTrue(manifest["ordered_tasks"][0]["verification_commands"])
            self.assertTrue(all("\\" not in path for path in manifest["ignored_generated_paths"]))
        task_projection = lambda manifest: [
            (item["task_id"], item["sequence"], item["dependencies"], item["allowed_paths"])
            for item in manifest["ordered_tasks"]
        ]
        self.assertEqual(task_projection(manifests[0]), task_projection(manifests[1]))
        ready = json.loads(self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-101", vendored=True).stdout)
        self.assertEqual("ready", ready["状态"], ready)

        blueprint = self.root / "docs/02-产品与版本/产品蓝图.md"
        original = blueprint.read_text(encoding="utf-8")
        blueprint.write_text(original + "\n权威范围发生变化。\n", encoding="utf-8")
        stale = json.loads(self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-101", vendored=True).stdout)
        self.assertEqual("stale", stale["状态"])
        self.assertTrue(any("权威文档摘要" in item for item in stale["过期原因"]))
        ci_stale = json.loads(
            self.run_cli(
                "goal-status",
                "--root",
                ".",
                "--goal",
                "GOAL-V1-101",
                "--read-only",
                "--fail-on-stale",
                expected=1,
                vendored=True,
            ).stdout
        )
        self.assertEqual("stale", ci_stale["状态"])
        blueprint.write_text(original, encoding="utf-8")

        note = self.root / "baseline-note.txt"
        note.write_text("new committed baseline\n", encoding="utf-8")
        self.commit_all("change goal baseline")
        head_stale = json.loads(self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-102", vendored=True).stdout)
        self.assertEqual("stale", head_stale["状态"])
        self.assertTrue(any("HEAD" in item for item in head_stale["过期原因"]))

        manifest_path = self.root / ".daoge-docs/goals/GOAL-V1-102/goal-manifest.json"
        tampered = json.loads(manifest_path.read_text(encoding="utf-8"))
        tampered["objective"] = "手工绕过权威的新目标"
        self.write_json(manifest_path, tampered)
        rejected = self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-102", expected=2, vendored=True)
        self.assertIn("语义内容已被修改", rejected.stderr)

    def test_p1_goal_without_git_or_ready_contract_stays_blocked(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", vendored=True)
        result = json.loads(self.run_cli("prepare-goal", "--root", ".", "--feature", "DOP-FR-001", vendored=True).stdout)
        self.assertEqual("blocked", result["状态"])
        manifest = json.loads((self.root / ".daoge-docs/goals" / result["Goal ID"] / "goal-manifest.json").read_text(encoding="utf-8"))
        codes = {item["code"] for item in manifest["blocking_findings"]}
        self.assertTrue({"SOURCE_COMMIT", "ALLOWED_PATHS"}.issubset(codes))

    def test_p2_goal_checkpoint_resume_and_complete_lifecycle(self) -> None:
        self.init()
        self.complete_for_goal()
        prepared = json.loads(
            self.run_cli(
                "prepare-goal", "--root", ".", "--feature", "DOP-FR-001", "--goal-id", "GOAL-V1-201", vendored=True
            ).stdout
        )
        self.assertEqual("ready", prepared["状态"])

        context = json.loads(
            self.run_cli("goal-resume-context", "--root", ".", "--goal", "GOAL-V1-201", vendored=True).stdout
        )
        self.assertEqual("running", context["status"])
        self.assertEqual("TASK-DOP-FR-001", context["task"]["task_id"])
        self.assertEqual(context["source_commit"], context["resume_commit"])
        self.assertTrue(context["task"]["allowed_paths"])
        self.assertTrue(context["task"]["verification_commands"])
        self.assertIn("goal-checkpoint", context["checkpoint_command"])

        service = self.root / "src/orders/service.py"
        service.write_text("def create_order():\n    return 'order-002'\n", encoding="utf-8")
        self.commit_all("complete order task")
        checkpoint = json.loads(
            self.run_cli(
                "goal-checkpoint",
                "--root",
                ".",
                "--goal",
                "GOAL-V1-201",
                "--task",
                "TASK-DOP-FR-001",
                vendored=True,
            ).stdout
        )
        self.assertEqual("checkpointed", checkpoint["状态"])
        self.assertEqual("CP-001", checkpoint["检查点"])
        self.assertEqual(["src/orders/service.py"], checkpoint["变更路径"])
        self.assertTrue(checkpoint["证据"])

        status = json.loads(
            self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-201", "--read-only", vendored=True).stdout
        )
        self.assertEqual("running", status["状态"])
        self.assertEqual("CP-001", status["最近检查点"])
        self.assertEqual("", status["下一任务"])

        completed = json.loads(
            self.run_cli("goal-complete", "--root", ".", "--goal", "GOAL-V1-201", vendored=True).stdout
        )
        self.assertEqual("completed", completed["状态"])
        self.assertEqual(1, completed["检查点数"])
        self.assertGreaterEqual(completed["最终验证数"], 1)
        completion_path = self.root / completed["完成记录"]
        completion = json.loads(completion_path.read_text(encoding="utf-8"))
        self.assertFalse(completion["release_allowed"])
        self.assertEqual("passed", completion["docs_check"])

        self.commit_all("record completed goal metadata")
        final_status = json.loads(
            self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-201", "--read-only", vendored=True).stdout
        )
        self.assertEqual("completed", final_status["状态"])
        rejected = self.run_cli("goal-complete", "--root", ".", "--goal", "GOAL-V1-201", expected=2, vendored=True)
        self.assertIn("已完成", rejected.stderr)

        blueprint = self.root / "docs/02-产品与版本/产品蓝图.md"
        original_blueprint = blueprint.read_text(encoding="utf-8")
        blueprint.write_text(original_blueprint + "\n下一版本权威变化。\n", encoding="utf-8")
        historical = json.loads(
            self.run_cli("goal-status", "--root", ".", "--goal", "GOAL-V1-201", "--read-only", vendored=True).stdout
        )
        self.assertEqual("completed", historical["状态"])
        self.assertEqual("historical", historical["完成记录当前性"])
        blueprint.write_text(original_blueprint, encoding="utf-8")

        evidence_path = self.root / completion["verification_evidence_paths"][0]
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        evidence["result"] = "failed"
        self.write_json(evidence_path, evidence)
        tampered = self.run_cli(
            "goal-status", "--root", ".", "--goal", "GOAL-V1-201", "--read-only", expected=2, vendored=True
        )
        self.assertIn("Goal 证据摘要无效", tampered.stderr)

    def test_p2_checkpoint_rejects_failed_verification_and_out_of_scope_paths(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli(
            "prepare-goal", "--root", ".", "--feature", "DOP-FR-001", "--goal-id", "GOAL-V1-202", vendored=True
        )
        self.run_cli("goal-resume-context", "--root", ".", "--goal", "GOAL-V1-202", vendored=True)
        outside = self.root / "notes.txt"
        outside.write_text("not authorized\n", encoding="utf-8")
        self.commit_all("touch unauthorized path")
        rejected = self.run_cli(
            "goal-checkpoint", "--root", ".", "--goal", "GOAL-V1-202", "--task", "TASK-DOP-FR-001", expected=2, vendored=True
        )
        self.assertIn("授权范围外路径", rejected.stderr)

    def test_p2_checkpoint_records_failed_verification_without_advancing(self) -> None:
        self.init()
        self.complete_for_goal()
        self.run_cli(
            "prepare-goal", "--root", ".", "--feature", "DOP-FR-001", "--goal-id", "GOAL-V1-203", vendored=True
        )
        self.run_cli("goal-resume-context", "--root", ".", "--goal", "GOAL-V1-203", vendored=True)
        test_file = self.root / "tests/orders/test_create_order.py"
        test_file.write_text(
            "import unittest\n\nclass OrderTest(unittest.TestCase):\n    def test_create(self):\n        self.assertTrue(False)\n",
            encoding="utf-8",
        )
        self.commit_all("introduce failing verification")
        failed = self.run_cli(
            "goal-checkpoint", "--root", ".", "--goal", "GOAL-V1-203", "--task", "TASK-DOP-FR-001", expected=2, vendored=True
        )
        self.assertIn("任务验证失败", failed.stderr)
        manifest = json.loads(
            (self.root / ".daoge-docs/goals/GOAL-V1-203/goal-manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual("verification_failed", manifest["status"])
        self.assertFalse(manifest["checkpoints"])
        evidence_paths = manifest["ordered_tasks"][0]["last_attempt"]["evidence_paths"]
        self.assertTrue(evidence_paths)
        evidence = json.loads((self.root / evidence_paths[0]).read_text(encoding="utf-8"))
        self.assertEqual("failed", evidence["result"])

    def test_p2_integrations_are_installable_and_never_overwrite(self) -> None:
        self.init()
        first = json.loads(self.run_cli("install-integrations", "--root", ".", vendored=True).stdout)
        expected = {
            ".github/workflows/daoge-docs.yml",
            ".github/pull_request_template.md",
            ".vscode/tasks.json",
            "AGENTS.md",
        }
        self.assertEqual(expected, set(first["新建"]))
        tasks_path = self.root / ".vscode/tasks.json"
        tasks = json.loads(tasks_path.read_text(encoding="utf-8"))
        labels = {item["label"] for item in tasks["tasks"]}
        self.assertIn("DAOGE Docs: Goal 恢复上下文", labels)
        self.assertIn("DAOGE Docs: Goal 完成", labels)
        before = {path: (self.root / path).read_bytes() for path in expected}
        second = json.loads(self.run_cli("install-integrations", "--root", ".", vendored=True).stdout)
        self.assertEqual(expected, set(second["保留已有"]))
        self.assertEqual(before, {path: (self.root / path).read_bytes() for path in expected})

    def test_upgrade_is_idempotent_when_run_from_vendored_tool(self) -> None:
        self.init()
        result = self.run_cli("upgrade", "--root", ".", "--profile", "strict", vendored=True)
        self.assertIn("工具与文档清单已升级", result.stdout)

    def test_v2_snapshot_is_immutable_and_exposed_to_browser(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", vendored=True)
        self.run_cli("index", "--root", ".", vendored=True)

        first = json.loads(self.run_cli("snapshot", "--root", ".", "--version", "V1", vendored=True).stdout)
        snapshot_path = self.root / first["文件"]
        self.assertTrue(snapshot_path.exists())
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        for key in ["snapshot_id", "immutable", "version", "source_commit", "authority_digest", "features", "requirements", "acceptance", "api_digest", "data_digest", "decisions"]:
            self.assertIn(key, snapshot)
        self.assertTrue(snapshot["immutable"])

        second = json.loads(self.run_cli("snapshot", "--root", ".", "--version", "V1", vendored=True).stdout)
        self.assertIn("不可变", second["状态"])
        self.assertEqual(snapshot_path.read_text(encoding="utf-8"), (self.root / second["文件"]).read_text(encoding="utf-8"))

        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        feature.write_text(feature.read_text(encoding="utf-8") + "\n版本审查变更。\n", encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        changed = json.loads(self.run_cli("snapshot", "--root", ".", "--version", "V1", vendored=True).stdout)
        self.assertNotEqual(first["权威摘要"], changed["权威摘要"])
        browser_data = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_data.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        self.assertEqual(2, len(payload["snapshots"]))
        self.assertIn("evidence_freshness", payload)
        self.assertTrue(payload["change_summary"]["available"])
        self.assertFalse(any(item.get("change") == "unchanged" for item in payload["change_summary"]["items"]))

    def test_v2_snapshot_diff_detects_feature_semantic_changes(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli("new-feature", "--root", ".", "--number", "1", "--name", "创建订单", "--domain", "订单", vendored=True)
        self.run_cli("index", "--root", ".", vendored=True)

        first = json.loads(self.run_cli("snapshot", "--root", ".", "--version", "V1", vendored=True).stdout)
        first_snapshot = json.loads((self.root / first["文件"]).read_text(encoding="utf-8"))

        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        original = feature.read_text(encoding="utf-8")
        feature.write_text(original.replace(
            "[待填写：说明用户问题、业务结果和可衡量成功指标。]",
            "支持开发者在一次请求中确定性创建订单，并返回可追踪结果。",
            1,
        ), encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        second = json.loads(self.run_cli("snapshot", "--root", ".", "--version", "V1", vendored=True).stdout)
        second_snapshot = json.loads((self.root / second["文件"]).read_text(encoding="utf-8"))

        self.assertNotEqual(
            first_snapshot["features"][0]["semantic_digest"],
            second_snapshot["features"][0]["semantic_digest"],
        )

        browser_data = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        payload = json.loads(browser_data.split("Object.freeze(", 1)[1].rsplit(");", 1)[0])
        snapshots = {item["snapshot_id"]: item for item in payload["snapshots"]}
        baseline = snapshots[first_snapshot["snapshot_id"]]
        compare = snapshots[second_snapshot["snapshot_id"]]
        self.assertNotEqual(
            baseline["features"][0]["semantic_digest"],
            compare["features"][0]["semantic_digest"],
        )
        self.assertIn("summary", compare["features"][0])
        change = next(item for item in payload["change_summary"]["items"] if item["id"] == "DOP-FR-001")
        self.assertEqual("changed", change["change"])

    def test_release_gate_recalculates_and_rejects_weak_evidence(self) -> None:
        self.init()
        self.complete_for_release()
        paths = self.create_passing_evidence()

        passed = json.loads(self.run_cli("gate", "--root", ".", "--stage", "release", "--json", vendored=True).stdout)
        self.assertTrue(passed["通过"])

        blueprint = self.root / "docs/02-产品与版本/产品蓝图.md"
        original_blueprint = blueprint.read_text(encoding="utf-8")
        blueprint.write_text(original_blueprint + "\n批准后的权威变更。\n", encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        failed = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("权威文档摘要已失效" in error for error in failed["错误"]))
        blueprint.write_text(original_blueprint, encoding="utf-8")
        self.run_cli("index", "--root", ".", vendored=True)
        passed = json.loads(self.run_cli("gate", "--root", ".", "--stage", "release", "--json", vendored=True).stdout)
        self.assertTrue(passed["通过"])

        performance = json.loads(paths["performance"].read_text(encoding="utf-8"))
        performance["details"]["scenarios"][0]["actual"] = 400
        self.write_json(paths["performance"], performance)
        failed = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("复算结果不一致" in error and "PERF-001" in error for error in failed["错误"]))
        performance["details"]["scenarios"][0]["actual"] = 240
        self.write_json(paths["performance"], performance)

        e2e = json.loads(paths["e2e"].read_text(encoding="utf-8"))
        e2e["details"]["cases"][0]["result"] = "skipped"
        self.write_json(paths["e2e"], e2e)
        failed = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("E2E 关键用例未通过" in error for error in failed["错误"]))
        e2e["details"]["cases"][0]["result"] = "passed"
        self.write_json(paths["e2e"], e2e)

        release = json.loads(paths["release"].read_text(encoding="utf-8"))
        release["details"]["rollback"]["status"] = "not_run"
        self.write_json(paths["release"], release)
        failed = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("rollback 未通过" in error for error in failed["错误"]))
        release["details"]["rollback"]["status"] = "passed"
        release["approval"]["confirmed_at"] = release["executed_at"]
        self.write_json(paths["release"], release)
        failed = json.loads(
            self.run_cli("gate", "--root", ".", "--stage", "release", "--json", expected=1, vendored=True).stdout
        )
        self.assertTrue(any("批准时间必须晚于全部证据" in error for error in failed["错误"]))

    def test_forbidden_paths_are_propagated_and_conflicts_block_goal(self) -> None:
        self.init()
        self.run_cli("new-domain", "--root", ".", "--name", "订单", vendored=True)
        self.run_cli(
            "new-feature",
            "--root",
            ".",
            "--number",
            "1",
            "--name",
            "创建订单",
            "--domain",
            "订单",
            "--forbidden-paths",
            "src/admin,tests/fixtures",
            vendored=True,
        )
        feature = self.root / "docs/03-功能规格/V1/订单/01-创建订单.md"
        text = feature.read_text(encoding="utf-8").replace("| 后端 | [待填写] | [待填写] |", "| 后端 | src/admin/service.py | [待填写] |")
        feature.write_text(text, encoding="utf-8")
        failed = json.loads(self.run_cli("check", "--root", ".", "--json", expected=1, vendored=True).stdout)
        self.assertTrue(any("允许路径与禁止路径冲突" in error for error in failed["错误"]))
        prepared = json.loads(self.run_cli("prepare-goal", "--root", ".", "--feature", "DOP-FR-001", vendored=True).stdout)
        manifest = json.loads((self.root / ".daoge-docs/goals" / prepared["Goal ID"] / "goal-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual("blocked", manifest["status"])
        self.assertTrue(any(item["code"] == "PATH_CONFLICT" for item in manifest["blocking_findings"]))
        self.assertEqual(["src/admin", "tests/fixtures"], manifest["ordered_tasks"][0]["forbidden_paths"])

    def test_browser_check_uses_closed_utf8_sources(self) -> None:
        self.init()
        rejected = self.run_cli(
            "new-requirement",
            "--root",
            ".",
            "--type",
            "NFR",
            "--name",
            "登录接口延迟",
            "--source",
            "V1 产品需求文档",
            "--verification",
            "性能场景 PERF-001",
            expected=2,
            vendored=True,
        )
        self.assertIn("必须指向项目 docs 内真实存在的文件", rejected.stderr)
        result = json.loads(self.run_cli("browser-check", "--root", ".", "--json", vendored=True).stdout)
        self.assertTrue(result["通过"], result)
        browser_js = (self.root / "docs/90-参考资料/产品文档浏览器-文档数据.js").read_text(encoding="utf-8")
        self.assertNotIn(str(self.root), browser_js)

    def test_goal_managed_paths_normalize_windows_separators(self) -> None:
        manifest = {
            "goal_id": "GOAL-V1-001",
            "ignored_generated_paths": ["docs\\90-参考资料\\产品文档浏览器-文档数据.js"],
        }
        self.assertTrue(
            load_cli_module().goal_managed_git_path(
                manifest,
                "docs/90-参考资料/产品文档浏览器-文档数据.js",
            )
        )


if __name__ == "__main__":
    unittest.main()
