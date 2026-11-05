#!/usr/bin/env python3
"""Extract the pinned, publicly served RIS token block without running its JS.

Usage: python3 scripts/extract-density-reference.py /path/to/styles-PIBQ3WXW.css
Outputs are an evidence snapshot and the default GCSP theme, never a framework package.
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
        "--gcsp-font-heading": "--ds-typography-family-title-lg",
        "--gcsp-font-heading-weight": "--ds-typography-weight-title-lg",
        "--gcsp-font-code": "--ds-typography-family-code",
        "--gcsp-font-weight": "--ds-typography-weight-regular",
        "--gcsp-font-strong-weight": "--ds-typography-weight-strong",
        "--gcsp-font-button-weight": "--ds-typography-weight-button",
        "--gcsp-font-input-weight": "--ds-font-weight-input",
        "--gcsp-font-table-header-weight": "--ds-font-weight-table-header",
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
    typography_aliases = {key: value for key, value in aliases.items() if key.startswith("--gcsp-font")}

    def include(key):
        if key in selected:
            return
        selected.add(key)
        for dependency in references.findall(tokens[key]):
            include(dependency)

    for key in typography_aliases.values():
        include(key)
    typography_selected = selected.copy()
    selected.clear()
    for key, value in aliases.items():
        if key in typography_aliases:
            continue
        include(value)
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
        '@import "./density-typography.css";',
        "",
        "/* Generated by scripts/extract-density-reference.py from the pinned RIS CSS.",
        f"   Source: {SOURCE}",
        f"   SHA-256: {digest}",
        "   Default GCSP theme, imported by gcsp-tokens.css and scoped to .gcsp.",
        "   Only observed tokens and local aliases; no vendor components or global reset.",
        "   Header/navigation/touch-target sizes retain the existing GCSP kit decisions. */",
        "",
        ".gcsp {",
    ]
    lines += [f"  {key}: {tokens[key]};" for key in tokens if key in selected]
    lines += ["", "  /* Local mapping into the existing shared component kit. */"]
    lines += [f"  {key}: var({value});" for key, value in aliases.items() if key not in typography_aliases]
    lines += ["}", ""]
    theme = ROOT / "blocks/gcsp/shell/density-theme.css"
    theme.write_text("\n".join(lines))
    type_lines = [
        '@import "./fonts/density-fonts.css";', "",
        "/* Generated from the same pinned RIS source as density-theme.css.",
        "   Source role families/weights; local responsive sizes remain in the kit. */", ".gcsp {",
    ]
    type_lines += [f"  {key}: {tokens[key]};" for key in tokens if key in typography_selected]
    type_lines += [f"  {key}: var({value});" for key, value in typography_aliases.items()]
    type_lines += ["  font-family: var(--gcsp-font);", "  font-weight: var(--gcsp-font-weight);", "}", "",
                   ".gcsp h1.vm-title, .gcsp h1.gcsp-page-title {",
                   "  font-family: var(--gcsp-font-heading), var(--gcsp-font);",
                   "  font-weight: var(--gcsp-font-heading-weight);", "}",
                   ".gcsp h2, .gcsp h3, .gcsp h4, .gcsp h5, .gcsp h6, .gcsp legend {",
                   "  font-family: var(--gcsp-font);", "  font-weight: var(--gcsp-font-strong-weight);", "}",
                   ".gcsp button, .gcsp input, .gcsp select, .gcsp textarea { font-family: var(--gcsp-font); }",
                   ".gcsp input, .gcsp select, .gcsp textarea { font-weight: var(--gcsp-font-input-weight); }",
                   ".gcsp .vm-btn { font-weight: var(--gcsp-font-button-weight); }",
                   ".gcsp code, .gcsp pre { font-family: var(--gcsp-font-code); font-weight: var(--gcsp-font-weight); }",
                   ".gcsp .vm-option-label, .gcsp .vm-card-line { font-weight: var(--gcsp-font-weight); }",
                   ".gcsp .vm-card-name, .gcsp .vm-slider-value, .gcsp .vm-kicker, .gcsp .vm-score, .gcsp .vm-why-label, .gcsp strong, .gcsp b { font-weight: var(--gcsp-font-strong-weight); }", ""]
    (theme.parent / "density-typography.css").write_text("\n".join(type_lines))
    print(json.dumps({"tokens": len(tokens), "assetDeclarationsExcluded": len(core) - len(tokens),
                      "themeTokenCount": len(selected), "theme": str(theme),
                      "resolvedAliases": snapshot["resolvedGcspAliases"]}, indent=2))


if __name__ == "__main__":
    main()
