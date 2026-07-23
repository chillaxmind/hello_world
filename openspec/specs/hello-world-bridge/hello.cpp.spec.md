# Per-file Spec — hello.cpp

> Implementation contract for `hello.cpp` (member of the `hello-world-bridge`
> capability). Whole-file document structured by the T_annotate sections.
> There are NO per-symbol `### <name>` sections — the spec is whole-file. The
> capability spec (`openspec/specs/hello-world-bridge.spec.md`) states the
> cross-file WHAT; this spec states the HOW for this file.

## Symbols

- `hello_world` — greeting function bound to Python.
- `main` — native executable entry point (not exposed to Python).
- `hello_world_module` — the `PYBIND11_MODULE(hello_world, m)` block; expands to
  the `PyInit_hello_world` module-init function that registers the Python
  extension module.

## PURPOSE

This file implements the C++ side of the hello-world bridge: a greeting
function, a standalone native entry point, and the pybind11 registration that
exposes the greeting to Python as the `hello_world` module.

## DEPENDS_ON

- `<iostream>` — `std::cout` and `std::endl` for stdout output (`hello_world`,
  `main`).
- `<pybind11/pybind11.h>` — the `PYBIND11_MODULE` macro and the `module_` API
  (`m.doc()`, `m.def()`) used by `hello_world_module`.
- The C++ `hello_world` function, referenced by address (`&hello_world`) from
  `hello_world_module` as the binding target.
- The Python C-API runtime (via pybind11) at module import time.
- Build system: must produce a Python extension module whose importable name is
  `hello_world` (consumed by `hello.py`'s `import hello_world`).

## BEHAVIOR

### `hello_world`

1. Write the literal string `Hello World from Python caller!` to `std::cout`.
2. Write a newline via `std::endl` (also flushes the stream).
3. Return void.

**Scenario — called from Python**: `hello_world.hello_world()` (after
`import hello_world`) prints exactly `Hello World from Python caller!` followed
by a newline.

**Scenario — called repeatedly**: each invocation prints the line again; output
is cumulative.

### `main`

1. Write the literal string `Hello World!` to `std::cout`.
2. Write a newline via `std::endl` (also flushes the stream).
3. Return `0` to the host environment.

**Scenario — run as executable**: building and running the translation unit as
a standalone program prints `Hello World!` followed by a newline and exits with
status `0`.

**Scenario — built as a Python extension**: `main` is not invoked by the Python
import path and may be excluded by the pybind11 build.

### `hello_world_module`

1. The `PYBIND11_MODULE(hello_world, m)` macro expands to the module-init
   function `PyInit_hello_world`.
2. On `import hello_world`, set the module docstring to `"Hello World"` via
   `m.doc()`.
3. Register a module attribute named `hello_world` bound to the C++ function
   `&hello_world`, with help text `"Hello World"`, via `m.def(...)`.
4. Return the module object to Python.

**Scenario — import from Python**: `import hello_world` yields a module object
with `__doc__ == "Hello World"` and a callable attribute `hello_world` whose
`__doc__ == "Hello World"`.

## INVARIANTS

- `hello_world` emits exactly the fixed string plus one newline; it is
  deterministic, idempotent, and free of side effects beyond the stdout write.
- `main` always returns `0` (EXIT_SUCCESS convention) and emits exactly one
  line. Its signature is `int main()` — no command-line arguments are accepted.
- The module name argument to `PYBIND11_MODULE` (`hello_world`) MUST match the
  importable Python module name (the extension's build target name). This is
  the cross-file naming contract with `hello.py`.
- The exposed Python attribute `hello_world` MUST map to the C++
  `&hello_world` function. Registration occurs exactly once per import.
- `main` is NOT exposed through the Python binding; the binding surface is
  exactly `{ hello_world }`.

## EDGE_CASES

- stdout write failures set the iostream error state but are never checked in
  `hello_world` or `main`; such errors are silent.
- No input validation is performed or required (neither greeting accepts
  arguments; `main` declares no parameters).
- If the extension is built under a target name other than `hello_world`,
  `import hello_world` (in `hello.py`) fails with `ModuleNotFoundError`.
- No error handling exists inside the `PYBIND11_MODULE` block; registration
  errors propagate as Python C-API exceptions at import time.
- If `&hello_world` is unavailable at link time, the build fails — a
  compile/link-time error, not a runtime one.
