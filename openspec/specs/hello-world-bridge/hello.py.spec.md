# Per-file Spec — hello.py

> Implementation contract for `hello.py` (member of the `hello-world-bridge`
> capability). Whole-file document structured by the T_annotate sections.
> There are NO per-symbol `### <name>` sections — the spec is whole-file. The
> capability spec (`openspec/specs/hello-world-bridge.spec.md`) states the
> cross-file WHAT; this spec states the HOW for this file.

## Symbols

- `__main__` — the `if __name__ == "__main__":` guard block; the Python script
  entry point. (Named `__main__` for a clean pseudo-anchor. The file has no
  `def`/`lambda`; the guard block is the file's unit of behavior and the direct
  analog of `main()` in `hello.cpp`.)

## PURPOSE

Python-side entry point of the hello-world bridge. When run as a program, it
imports the C++ extension module built from `hello.cpp` and invokes the bound
greeting, producing the canonical `Hello World from Python caller!` output.

## DEPENDS_ON

- The importable Python extension module `hello_world` — built from `hello.cpp`
  via pybind11, registered by `PYBIND11_MODULE(hello_world, m)`.
- That module's attribute `hello_world`, which is the C++ `hello_world()`
  function bound through `m.def("hello_world", &hello_world, ...)`.
- The extension must be built and present on `sys.path` at runtime.
- No other imports.

## BEHAVIOR

### `__main__`

1. At module load, execute `import hello_world` (line 1) — always runs,
   whether the file is run as a script or imported.
2. At runtime, evaluate `if __name__ == "__main__":` — true only when `hello.py`
   is the entry module (run as a script).
3. When the guard is true, call `hello_world.hello_world()`.
4. That call prints `Hello World from Python caller!` to stdout (the C++
   function's behavior) followed by a newline.
5. The script exits with status `0` (no explicit `sys.exit`).

**Scenario — run as a script** (`python hello.py` or `python -m hello`):
prints `Hello World from Python caller!` followed by a newline, exits `0`.

**Scenario — imported as a module** (`import hello`): line 1 runs (importing
the `hello_world` extension as a side effect); the guard is false, so
`hello_world.hello_world()` is NOT called; no output.

## INVARIANTS

- The guarded block executes only when `hello.py` is the entry module
  (`__name__ == "__main__"`); it does not run on import.
- The `import hello_world` on line 1 always runs, regardless of how the file is
  invoked.
- The call is exactly `hello_world.hello_world()` — no arguments, no return
  value consumed.
- The module name `hello_world` (in `import hello_world`) MUST match the
  `PYBIND11_MODULE` name and the extension's build target — the cross-file
  naming contract with `hello.cpp`.

## EDGE_CASES

- If the `hello_world` extension is not built or not on `sys.path`,
  `import hello_world` raises `ImportError` (or `ModuleNotFoundError`) at line
  1 — before the guard — and the script aborts with a traceback.
- If the extension exists but lacks the attribute `hello_world`, an
  `AttributeError` is raised at the call site (line 4 of L0).
- No error handling is present; failures propagate as uncaught exceptions.
- Both `python hello.py` and `python -m hello` set `__name__` to `"__main__"`,
  so both trigger the guard; importing the file as a module does not.
