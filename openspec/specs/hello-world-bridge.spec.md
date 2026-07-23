# Capability Spec — hello-world-bridge

> Cross-file spec for the **hello-world-bridge** capability.
> States the WHAT (behavior, invariants, cross-file concerns). Per-file
> implementation contracts (the HOW) live under
> `openspec/specs/hello-world-bridge/<file>.spec.md` and are written by Op1
> (annotate). This capability spec is the single writer-scope of Op0 (discover).

## Purpose

Expose a single greeting behavior — "print Hello World" — to a Python caller by
implementing it in C++ and binding it into a Python-importable module via
pybind11. A secondary, independent behavior — a native `main()` that prints a
greeting directly to stdout — exists in the same C++ translation unit but is
not part of the Python-facing surface.

## Behavior

1. **Greeting (`hello_world`)** — when called (from Python via the binding, or
   directly from C++), prints the line `Hello World from Python caller!` to
   stdout, followed by a newline.
2. **Native entry (`main`)** — when the C++ translation unit is built and run
   as a standalone executable, prints the line `Hello World!` to stdout,
   followed by a newline, and returns exit status `0`.
3. **Python binding (`PYBIND11_MODULE hello_world`)** — builds a Python extension
   module named `hello_world` whose docstring is `"Hello World"` and which
   exposes one attribute: the function `hello_world`, bound to the C++
   `hello_world()` function, with the help string `"Hello World"`.
4. **Python entry (`hello.py`)** — when executed as a script (`__main__`), imports
   the bound `hello_world` module and invokes `hello_world.hello_world()`,
   producing the greeting output described in (1).

## Invariants

- The Python-visible module name is exactly `hello_world`; `hello.py` imports
  that name. Renaming either side without the other breaks the bridge.
- The C++ symbol bound to Python under the name `hello_world` is the C++
  `hello_world()` function. The Python attribute name and the C++ function name
  coincide by convention, not by enforcement.
- `main()` is a native-only entry point and is **not** exposed through the
  Python binding. The binding surface is exactly `{ hello_world }`.

## Cross-file concerns

- **Naming contract across the FFI boundary**: `hello.cpp`'s
  `PYBIND11_MODULE(hello_world, …)` defines the Python module name that
  `hello.py`'s `import hello_world` depends on. A change to the module name on
  the C++ side requires a matching change in `hello.py`, and vice versa.
- **Build dependency**: `hello.py` can only run after `hello.cpp` is compiled
  into the `hello_world` Python extension module (pybind11 build). `hello.py`
  has no fallback if the extension is absent — the import will fail at runtime.

## Member files

- `hello.cpp` — greeting implementation, native `main()`, and the pybind11
  module binding that exposes `hello_world` to Python.
- `hello.py` — Python entry point that imports the bound module and invokes
  the greeting.
