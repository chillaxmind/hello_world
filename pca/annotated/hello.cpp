#include <iostream>
#include <pybind11/pybind11.h>

// @pca BEGIN FN: hello_world
// @pca PURPOSE:
// @pca   Print a fixed greeting ("Hello World from Python caller!") to stdout. This is the canonical greeting behavior exposed to Python through the pybind11 binding.
// @pca DEPENDS_ON:
// @pca   std::cout and std::endl from <iostream> (C++ standard library). No other runtime dependencies. Callable from Python via the binding registered in hello_world_module.
// @pca BEHAVIOR:
// @pca   1. Write the literal string "Hello World from Python caller!" to std::cout. 2. Write a newline via std::endl (which also flushes the stream). 3. Return void.
// @pca INVARIANTS:
// @pca   Always emits exactly the fixed string plus one newline. Takes no arguments; has no side effects beyond the stdout write. Deterministic and idempotent across repeated calls.
// @pca EDGE_CASES:
// @pca   None handled explicitly. A failed stdout write sets the iostream error state but is never checked, so errors are silent. No input to validate; repeated calls simply repeat the output line.
// @pca END FN
void hello_world(){
    std::cout << "Hello World from Python caller!" << std::endl;
}

// @pca BEGIN FN: main
// @pca PURPOSE:
// @pca   Native executable entry point. Prints a standalone greeting ("Hello World!") to stdout and reports success to the host environment.
// @pca DEPENDS_ON:
// @pca   std::cout and std::endl from <iostream>. Invoked by the C++ runtime as the program entry point when the translation unit is built and run as a standalone executable. Independent of the pybind11 binding (not exposed to Python).
// @pca BEHAVIOR:
// @pca   1. Write the literal string "Hello World!" to std::cout. 2. Write a newline via std::endl (which also flushes the stream). 3. Return 0 to the host environment (success exit status).
// @pca INVARIANTS:
// @pca   Always returns 0 (the EXIT_SUCCESS convention). Emits exactly one line. The signature is int main() — argc/argv are not declared, so no command-line arguments are accepted.
// @pca EDGE_CASES:
// @pca   No argument validation (none are accepted). stdout write failures are unchecked. When the translation unit is built as a Python extension module rather than an executable, main is typically not invoked and may be excluded by the pybind11 build. No error paths.
// @pca END FN
int main(){

    std::cout << "Hello World!" << std::endl;

    return 0;
}

// @pca BEGIN FN: hello_world_module
// @pca PURPOSE:
// @pca   Register the Python extension module named hello_world, exposing the C++ hello_world() function to Python under the attribute name hello_world, with module docstring "Hello World".
// @pca DEPENDS_ON:
// @pca   pybind11 (<pybind11/pybind11.h>) — the PYBIND11_MODULE macro and the module_ API (m.doc(), m.def()). The C++ hello_world function, passed by address as &hello_world. The Python C-API runtime (via pybind11) at module import time.
// @pca BEHAVIOR:
// @pca   1. The PYBIND11_MODULE macro expands to the module init function PyInit_hello_world. 2. On Python `import hello_world`, set the module docstring to "Hello World" via m.doc(). 3. Register a module attribute named hello_world bound to the C++ function &hello_world with help text "Hello World" via m.def(...). 4. Return the module object to Python.
// @pca INVARIANTS:
// @pca   The module name argument to PYBIND11_MODULE ("hello_world") MUST match the importable Python module name (the extension's build target name). The exposed attribute "hello_world" MUST map to the C++ &hello_world function. Registration happens exactly once per import.
// @pca EDGE_CASES:
// @pca   If the extension is built under a target name other than hello_world, `import hello_world` fails with ModuleNotFoundError. No error handling inside the macro block — registration errors propagate as Python C-API exceptions at import time. If &hello_world is unavailable at link time, the build fails (a compile/link-time error, not a runtime one).
// @pca END FN
PYBIND11_MODULE(hello_world,m){
    m.doc() = "Hello World";
    m.def("hello_world", &hello_world, "Hello World");
}