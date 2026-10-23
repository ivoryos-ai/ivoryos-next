"""Every tool of the edge's MCP server (agent/mcp_server.py) says what it is and whether it
changes anything: a human-readable title and readOnlyHint, plus destructiveHint on a tool that
writes. Anthropic's Connectors Directory requires them of every tool, and MCP clients read them
to decide what to confirm. A tool that writes only files a proposal a person must accept
(AGENTS.md section 14), so it is never destructive and its description says so. The tools are
listed from the server object itself, so a tool added without them fails here."""

import asyncio

import pytest

pytest.importorskip("mcp")

from ivoryos_edge.agent import mcp_server  # noqa: E402

# The tools that file a proposal. Every other tool only reads.
PROPOSING = {"propose_workflow", "request_run", "propose_safety", "propose_step_fix", "propose_sample_changes"}


def _tools():
    # by_alias gives the wire names (readOnlyHint, ...) on both SDK generations.
    return [t.model_dump(by_alias=True) for t in asyncio.run(mcp_server.server.list_tools())]


def test_every_tool_has_a_title_and_says_whether_it_changes_anything():
    tools = _tools()
    assert PROPOSING <= {t["name"] for t in tools}
    problems = []
    for tool in tools:
        name, title, hints = tool["name"], tool.get("title"), tool.get("annotations") or {}
        if not (title or "").strip():
            problems.append(f"{name}: no title")
        if hints.get("title") != title:
            problems.append(f"{name}: annotations.title is not the tool's title")
        if hints.get("readOnlyHint") is None:
            problems.append(f"{name}: no readOnlyHint")
        elif not hints["readOnlyHint"] and hints.get("destructiveHint") is None:
            problems.append(f"{name}: writes but has no destructiveHint")
        if hints.get("openWorldHint") is not False:
            problems.append(f"{name}: openWorldHint is not false (every tool reaches only this deck)")
        if name in PROPOSING:
            if hints.get("readOnlyHint") is not False or hints.get("destructiveHint") is not False:
                problems.append(f"{name}: files a proposal, so readOnlyHint and destructiveHint are both false")
            description = " ".join((tool.get("description") or "").split())
            if "files a proposal" not in description or "until a person accepts it" not in description:
                problems.append(f"{name}: the description does not say it files a proposal that changes nothing until a person accepts it")
        elif hints.get("readOnlyHint") is not True:
            problems.append(f"{name}: only reads, so readOnlyHint is true (or add it to PROPOSING if it files a proposal)")
    assert not problems, "\n".join(problems)


def test_titles_are_unique():
    titles = [t["title"] for t in _tools()]
    assert len(titles) == len(set(titles))
