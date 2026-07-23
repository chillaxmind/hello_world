import hello_world

# @pca BEGIN FN: __main__
# @pca PURPOSE:
# @pca   Script entry point. When hello.py is run as a program (not imported), exercise the hello-world bridge by importing the bound C++ module and invoking its greeting, producing the canonical "Hello World from Python caller!" output.
# @pca DEPENDS_ON:
# @pca   The importable Python extension module hello_world (built from hello.cpp via pybind11) — specifically its attribute hello_world, which is the C++ hello_world() function bound through PYBIND11_MODULE. Depends on the module being built and importable on sys.path. No other imports.
# @pca BEHAVIOR:
# @pca   1. Import the hello_world extension module (top of file). 2. At runtime, when __name__ == "__main__" (i.e. run as a script), call hello_world.hello_world(). 3. That call prints "Hello World from Python caller!" to stdout via the C++ function. 4. The script then exits with status 0 (no explicit sys.exit).
# @pca INVARIANTS:
# @pca   The guarded block executes only when hello.py is the entry module (__name__ == "__main__"); it does not run on import. The import on line 1 always runs regardless. The call is exactly hello_world.hello_world() — no arguments, no return value consumed. The module name hello_world must match the PYBIND11_MODULE name and the build target (the cross-file naming contract).
# @pca EDGE_CASES:
# @pca   If the hello_world extension is not built or not on sys.path, `import hello_world` raises ImportError (or ModuleNotFoundError) at line 1 — before the guard — and the script aborts with a traceback. If the extension lacks attribute hello_world, AttributeError at line 4. No error handling; failures propagate as uncaught exceptions. Running `python -m hello` vs `python hello.py` both set __name__ to "__main__"; importing hello as a module does not trigger the guard.
# @pca END FN
if __name__ == "__main__":
    hello_world.hello_world()
