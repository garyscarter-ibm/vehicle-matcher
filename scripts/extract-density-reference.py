#!/usr/bin/env python3
"""Extract the pinned, publicly served RIS token block without running its JS.

Usage: python3 scripts/extract-density-reference.py /path/to/styles-PIBQ3WXW.css
Outputs are an evidence snapshot and an opt-in theme, never a framework package.
"""

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://www.ris.bmw.com/styles-PIBQ3WXW.css"
SHA256 = "49f8e1938e1cca36b7dd76d37c016fd91ef1774b6a24802def9ef049569a4777"


def split_css(text, delimiter):
    """Respect quoted data URIs and functions when splitting declarations."""
    start = 0
    quote = None
    escaped = False
    depth = 0
    for index, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif quote:
            if char == quote:
                quote = None
        elif char in "\"'":
            quote = char
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == delimiter and depth == 0:
            yield text[start:index]
            start = index + 1
    yield text[start:]


def root_blocks(text):
    """Read complete top-level rules; quoted braces do not delimit rules."""
    quote = None
    escaped = False
    depth = 0
    start = 0
    body = 0
    selector = ""
    for index, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif quote:
            if char == quote:
                quote = None
        elif char in "\"'":
            quote = char
        elif char == "{":
            if depth == 0:
                selector = text[start:index].strip()
                body = index + 1
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                if selector == ":root,:host":
                    yield text[body:index]
                start = index + 1


def main():
    data = Path(sys.argv[1]).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise ValueError("Source has changed: review it before updating the pinned hash")
    candidates = []
    for body in root_blocks(data.decode()):
        declarations = {}
        for declaration in split_css(body, ";"):
            name, colon, value = declaration.partition(":")
            if colon and name.strip().startswith("--ds-"):
                declarations[name.strip()] = value.strip()
        candidates.append(declarations)
    core = next(tokens for tokens in candidates if len(tokens) == 1640)
    # Preserve values, not embedded icon artwork. No downloaded code or fonts run.
    tokens = {key: value for key, value in core.items()
              if not key.startswith("--ds-asset-") and "url(" not in value}
    references = re.compile(r"var\((--ds-[\w-]+)\)")
    while True:
        dependent_assets = [key for key, value in tokens.items()
                            if any(ref not in tokens for ref in references.findall(value))]
        if not dependent_assets:
            break
        for key in dependent_assets:
            del tokens[key]

    def resolve(key, seen=()):
        if key in seen:
            raise ValueError(f"Cyclic token: {key}")
        return references.sub(lambda match: resolve(match[1], (*seen, key)), tokens[key])

    # An omitted asset must not leave a dangling alias in the reusable snapshot.
    for value in tokens.values():
        for dependency in references.findall(value):
            if dependency not in tokens:
                raise ValueError(f"Missing token dependency: {dependency}")
    for key in tokens:
        resolve(key)

    aliases = {
        "--gcsp-font": "--ds-typography-family-base",
        "--gcsp-surface": "--ds-color-surface-base",
        "--gcsp-surface-page": "--ds-color-surface-page",
        "--gcsp-surface-muted": "--ds-color-surface-neutral",
        "--gcsp-surface-raised": "--ds-color-surface-base",
        "--gcsp-text": "--ds-color-typography-base",
        "--gcsp-text-muted": "--ds-color-typography-neutral",
        "--gcsp-divider": "--ds-color-border-base",
        "--gcsp-accent": "--ds-color-surface-button-primary",
        "--gcsp-accent-strong": "--ds-color-surface-button-primary-hover",
        "--gcsp-accent-soft": "--ds-color-surface-action",
        "--gcsp-on-accent": "--ds-color-typography-button-primary",
        "--gcsp-focus": "--ds-color-outline-action",
        "--gcsp-danger": "--ds-color-typography-critical",
        "--gcsp-warning": "--ds-color-typography-caution",
        "--gcsp-success": "--ds-color-typography-positive",
        "--gcsp-unavailable": "--ds-color-typography-neutral",
        "--gcsp-radius": "--ds-shape-radius-box",
        "--gcsp-motion": "--ds-motion-duration-quick",
    }
    selected = set()

    def include(key):
        if key in selected:
            return
        selected.add(key)
        for dependency in references.findall(tokens[key]):
            include(dependency)

    for key in aliases.values():
        include(key)
    assert resolve("--ds-color-surface-button-primary") == "#037493"
    assert resolve("--ds-space-1x") == "4px"
    assert resolve("--ds-shape-radius-button") == "2px"
    assert resolve("--ds-shape-size-ymin-button") == "32px"

    destination = ROOT / "docs/gcsp/density"
    destination.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "capturedDate": "2026-11-05",
        "source": {"url": SOURCE, "sha256": digest, "bytes": len(data)},
        "scope": "RIS default light :root,:host core block; not dark mode or a package release",
        "coreDeclarationCount": len(core),
        "excludedAssetDeclarationCount": len(core) - len(tokens),
        "tokenCount": len(tokens),
        "tokens": tokens,
        "gcspAliases": aliases,
        "resolvedGcspAliases": {key: resolve(value) for key, value in aliases.items()},
    }
    (destination / "tokens.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    lines = [
        "/* Generated by scripts/extract-density-reference.py from the pinned RIS CSS.",
        f"   Source: {SOURCE}",
        f"   SHA-256: {digest}",
        "   Opt in with an ancestor .density-reference, or .gcsp.density-reference.",
        "   Only observed tokens and local aliases; no vendor components or global reset.",
        "   Header/navigation/touch-target sizes retain the existing GCSP kit decisions. */",
        "",
        ":where(.density-reference) .gcsp,",
        ".gcsp.density-reference {",
    ]
    lines += [f"  {key}: {tokens[key]};" for key in tokens if key in selected]
    lines += ["", "  /* Local mapping into the existing shared component kit. */"]
    lines += [f"  {key}: var({value});" for key, value in aliases.items()]
    lines += ["}", ""]
    theme = ROOT / "blocks/gcsp/shell/density-reference.css"
    theme.write_text("\n".join(lines))
    print(json.dumps({"tokens": len(tokens), "assetDeclarationsExcluded": len(core) - len(tokens),
                      "themeTokenCount": len(selected), "theme": str(theme),
                      "resolvedAliases": snapshot["resolvedGcspAliases"]}, indent=2))


if __name__ == "__main__":
    main()
