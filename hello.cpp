#include <iostream>
#include <pybind11/pybind11.h>

void hello_world(){
    std::cout << "Hello World from Python caller!" << std::endl;
}

int main(){

    std::cout << "Hello World!" << std::endl;

    return 0;
}

PYBIND11_MODULE(hello_world,m){
    m.doc() = "Hello World";
    m.def("hello_world", &hello_world, "Hello World");
}