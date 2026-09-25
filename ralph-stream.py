#!/usr/bin/env python3
"""Pretty-print `claude -p --output-format stream-json --verbose` events as they arrive.

Used by afk-ralph.sh so you can follow an AFK iteration live:
  💬 what Claude says    ▶ tools it calls    ✗ tool errors    ✔ the final result
"""
import json
import shutil
import sys
import time

DIM, BOLD, RED, GREEN, CYAN, RESET = "\033[2m", "\033[1m", "\033[31m", "\033[32m", "\033[36m", "\033[0m"
if not sys.stdout.isatty():
    DIM = BOLD = RED = GREEN = CYAN = RESET = ""
WIDTH = max(60, shutil.get_terminal_size((120, 20)).columns - 4)


def short(text, width=WIDTH):
    text = " ".join(str(text).split())
    return text if len(text) <= width else text[: width - 1] + "…"


def describe_tool(name, args):
    if name == "Bash":
        return f"$ {args.get('command', '')}"
    if name in ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit"):
        return f"{name} {args.get('file_path') or args.get('notebook_path', '')}"
    if name in ("Glob", "Grep"):
        return f"{name} {args.get('pattern', '')} {args.get('path', '')}".strip()
    if name == "TodoWrite":
        todos = args.get("todos", [])
        active = [t.get("content", "") for t in todos if t.get("status") == "in_progress"]
        return f"Todo: {active[0] if active else f'{len(todos)} items'}"
    if name.startswith("mcp__playwright__"):
        action = name.removeprefix("mcp__playwright__")
        detail = args.get("url") or args.get("element") or args.get("text") or ""
        return f"🌐 {action} {detail}".strip()
    return f"{name} {json.dumps(args)}"


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        print(DIM + short(line) + RESET, flush=True)
        continue

    kind = event.get("type")
    if kind == "system" and event.get("subtype") == "init":
        print(f"{DIM}model {event.get('model', '?')} · session {event.get('session_id', '?')[:8]}{RESET}", flush=True)
    elif kind == "assistant":
        for block in event.get("message", {}).get("content", []):
            if block.get("type") == "text" and block.get("text", "").strip():
                for paragraph in block["text"].strip().split("\n"):
                    if paragraph.strip():
                        print(f"💬 {short(paragraph)}", flush=True)
            elif block.get("type") == "tool_use":
                print(f"{CYAN}▶ {short(describe_tool(block.get('name', '?'), block.get('input', {})))}{RESET}", flush=True)
    elif kind == "user":
        content = event.get("message", {}).get("content", [])
        for block in content if isinstance(content, list) else []:
            if block.get("type") == "tool_result" and block.get("is_error"):
                body = block.get("content")
                if isinstance(body, list):
                    body = " ".join(part.get("text", "") for part in body if isinstance(part, dict))
                print(f"{RED}  ✗ {short(body or 'error')}{RESET}", flush=True)
    elif kind == "rate_limit_event":
        info = event.get("rate_limit_info", {})
        windows = info.get("unifiedWindows", {})
        parts = []
        for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
            window = windows.get(key)
            if window:
                resets = time.strftime("%H:%M %a", time.localtime(window.get("resetsAt", 0)))
                parts.append(f"{label} {window.get('utilization', 0):.0%} used (resets {resets})")
        overage = "OVERAGE IN USE" if info.get("isUsingOverage") else f"overage {info.get('overageStatus', '?')}"
        colour = RED if info.get("status") != "allowed" or info.get("isUsingOverage") else DIM
        print(f"{colour}📊 plan: {' · '.join(parts)} · {overage} · {info.get('status', '?')}{RESET}", flush=True)
    elif kind == "result":
        status = f"{RED}✗ error" if event.get("is_error") else f"{GREEN}✔ done"
        minutes = (event.get("duration_ms") or 0) / 60000
        cost = event.get("total_cost_usd") or 0
        print(f"{BOLD}{status}{RESET} in {minutes:.1f} min · ${cost:.2f} · {event.get('num_turns', '?')} turns", flush=True)
