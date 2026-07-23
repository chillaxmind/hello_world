## hello_world

BEHAVIOR:

1. Write the literal string "Hello World from Python caller!" to stdout.
2. Write a newline (flushing the stream).
3. Return (no value).

## main

BEHAVIOR:

1. Write the literal string "Hello World!" to stdout.
2. Write a newline (flushing the stream).
3. Return exit status 0 (success) to the host environment.

## hello_world_module

BEHAVIOR:

1. On Python `import hello_world`, initialize the extension module (the
   PYBIND11_MODULE macro expands to the module init function).
2. Set the module docstring to "Hello World".
3. Register a module attribute named `hello_world` bound to the C++
   `hello_world` function (passed by address as `&hello_world`), with help
   text "Hello World".
4. Return the module object to Python.
