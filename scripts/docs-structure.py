#!/usr/bin/env python3
"""Structural fingerprint of a Markdown doc: headings, images, links, code fences, tables.

Usage: docs-structure.py <file> [--save <json>] [--compare <json>]
A voice pass must leave the fingerprint unchanged (same headings in the same
order, same images, same link targets, same code blocks, same table count).
"""
import json
import re
import sys


def fingerprint(text: str) -> dict:
    lines = text.split("\n")
    headings, fences, in_fence, code_blocks, buf = [], 0, False, [], []
    tables = 0
    prev_table = False
    for line in lines:
        if line.strip().startswith("```"):
            in_fence = not in_fence
            if in_fence:
                buf = []
            else:
                code_blocks.append("\n".join(buf))
            fences += 1
            continue
        if in_fence:
            buf.append(line)
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            headings.append(f"{len(m.group(1))} {m.group(2).strip()}")
        is_table = line.strip().startswith("|")
        if is_table and not prev_table:
            tables += 1
        prev_table = is_table
    body = re.sub(r"```.*?```", "", text, flags=re.S)
    images = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", body) + re.findall(r"!\[\[([^\]]+)\]\]", body)
    links = sorted(set(re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", body)))
    return {
        "headings": headings,
        "images": images,
        "links": links,
        "code_blocks": code_blocks,
        "tables": tables,
        "words": len(body.split()),
    }


def main() -> int:
    path = sys.argv[1]
    fp = fingerprint(open(path, encoding="utf-8").read())
    if "--save" in sys.argv:
        out = sys.argv[sys.argv.index("--save") + 1]
        json.dump(fp, open(out, "w", encoding="utf-8"), indent=1)
        print(f"saved {out}: {len(fp['headings'])} headings, {len(fp['images'])} images, {len(fp['links'])} links, {len(fp['code_blocks'])} code blocks, {fp['tables']} tables, {fp['words']} words")
        return 0
    if "--compare" in sys.argv:
        ref = json.load(open(sys.argv[sys.argv.index("--compare") + 1], encoding="utf-8"))
        ok = True
        for key in ("headings", "images", "links", "code_blocks", "tables"):
            if fp[key] != ref[key]:
                ok = False
                print(f"DIFF in {key}:")
                if isinstance(fp[key], list):
                    a, b = ref[key], fp[key]
                    for x in a:
                        if x not in b:
                            print(f"  - missing: {x[:120]!r}")
                    for x in b:
                        if x not in a:
                            print(f"  + added:   {x[:120]!r}")
                    if sorted(a) == sorted(b):
                        print("  (same items, different order)")
                else:
                    print(f"  {ref[key]} -> {fp[key]}")
        ratio = fp["words"] / max(1, ref["words"])
        print(f"words: {ref['words']} -> {fp['words']} ({ratio:.2f}x)")
        if ratio < 0.75 or ratio > 1.25:
            ok = False
            print("DIFF: word count moved by more than 25%")
        print("STRUCTURE OK" if ok else "STRUCTURE CHANGED")
        return 0 if ok else 1
    print(json.dumps(fp, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
