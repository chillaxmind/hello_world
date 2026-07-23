## __main__

BEHAVIOR:

1. Import the `hello_world` extension module (built from `hello.cpp` via
   pybind11) — runs at module load regardless of how the file is invoked.
2. When the file is run as a script (`__name__ == "__main__"`), call
   `hello_world.hello_world()`.
3. That call prints "Hello World from Python caller!" to stdout via the bound
   C++ function.
4. Exit with status 0 (no explicit `sys.exit`).
