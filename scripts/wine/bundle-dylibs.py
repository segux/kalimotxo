#!/usr/bin/env python3
"""Make a Wine build self-contained: copy the x86_64 dylib chains it loads at
runtime into `<wine>/lib/wine/x86_64-unix`, next to Wine's unix modules.

Wine dlopen()s these by leaf name (libgnutls.30.dylib for TLS, libfreetype for
fonts, libSDL2 for controllers, libMoltenVK for Vulkan). On Apple Silicon users
have no x86_64 copies of them, so the runtime must ship its own. The unix
modules carry an `@loader_path/` rpath, so dyld finds the libraries in their
own directory. DYLD_FALLBACK_LIBRARY_PATH is not an option: macOS strips DYLD_*
from Wine's child processes (see src/backend/wine/wineRuntimeLibs.ts).

Each library is copied under its real file name, gets the install id
`@rpath/<name>`, and has its Homebrew dependencies rewritten to
`@loader_path/<name>`, so the chain resolves from whichever single directory it
lives in. The names Wine asks for (the roots given on the command line, often
symlinks such as libgnutls.30.dylib) become symlinks to the copies. System
libraries are left alone. Modified files are re-signed ad hoc, since
install_name_tool invalidates their signatures.

Usage: bundle-dylibs.py <wine-install-dir> <brew-prefix> <dylib> [<dylib> ...]
"""

import os
import shutil
import subprocess
import sys


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def deps_of(path: str) -> list[str]:
    # Only the x86_64 slice matters (Wine runs as x86_64); universal binaries
    # such as MoltenVK would otherwise print one header per architecture.
    # Skip the first line (the file itself); strip the version suffix.
    lines = run("otool", "-arch", "x86_64", "-L", path).splitlines()[1:]
    return [l.strip().split(" (compatibility")[0] for l in lines if l.strip()]


def resolve(dep: str, brew_prefix: str, origin: str) -> str | None:
    """Real path of a non-system dependency, or None for system libraries."""
    if dep.startswith(("/usr/lib/", "/System/")):
        return None
    if dep.startswith(brew_prefix):
        return os.path.realpath(dep)
    if dep.startswith(("@rpath/", "@loader_path/")):
        leaf = os.path.basename(dep)
        for base in (os.path.dirname(origin), os.path.join(brew_prefix, "lib")):
            candidate = os.path.join(base, leaf)
            if os.path.exists(candidate):
                return os.path.realpath(candidate)
        raise SystemExit(f"error: cannot resolve {dep} (needed by {origin})")
    return None


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    wine_dir, brew_prefix, roots = sys.argv[1], sys.argv[2].rstrip("/"), sys.argv[3:]
    dest = os.path.join(wine_dir, "lib", "wine", "x86_64-unix")
    os.makedirs(dest, exist_ok=True)

    # Walk the dependency graph from the roots; key by real path.
    queue = [os.path.realpath(r) for r in roots]
    graph: dict[str, list[tuple[str, str]]] = {}  # real path -> [(reference, real dep)]
    while queue:
        src = queue.pop()
        if src in graph:
            continue
        graph[src] = []
        for dep in deps_of(src):
            real = resolve(dep, brew_prefix, src)
            if real and real != src:
                graph[src].append((dep, real))
                queue.append(real)

    for src, deps in sorted(graph.items()):
        name = os.path.basename(src)
        target = os.path.join(dest, name)
        shutil.copy2(src, target)
        os.chmod(target, 0o755)
        run("install_name_tool", "-id", f"@rpath/{name}", target)
        for ref, real in deps:
            run("install_name_tool", "-change", ref, f"@loader_path/{os.path.basename(real)}", target)
        run("codesign", "--force", "--sign", "-", target)
        print(f"bundled {name}")

    for root in roots:
        leaf, real_name = os.path.basename(root), os.path.basename(os.path.realpath(root))
        link = os.path.join(dest, leaf)
        if leaf != real_name and not os.path.exists(link):
            os.symlink(real_name, link)
            print(f"linked {leaf} -> {real_name}")

    # Fail loudly if anything still points outside the bundle.
    for src in graph:
        target = os.path.join(dest, os.path.basename(src))
        for dep in deps_of(target):
            if dep.startswith(brew_prefix):
                raise SystemExit(f"error: {target} still references {dep}")
    print(f"{len(graph)} dylibs in {dest}")


if __name__ == "__main__":
    main()
