cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD pico2_w CACHE STRING "Board type")
set(PICO_PLATFORM rp2350-arm-s CACHE STRING "Platform")

include(pico_sdk_import.cmake)

project(opera_mitm C CXX ASM)
set(CMAKE_C_STANDARD 11)

pico_sdk_init()

add_executable(opera_mitm
    src/main.c
    src/opera.c
    src/usb_descriptors.c
)
target_include_directories(opera_mitm PRIVATE src)
target_link_libraries(opera_mitm
    pico_stdlib
    pico_unique_id
    hardware_uart
    hardware_adc
    hardware_watchdog
    tinyusb_device
    tinyusb_board
)
# No stdio over USB/UART: the CDC console is ours, and uart0/uart1 are the OPERA link.
pico_enable_stdio_usb(opera_mitm 0)
pico_enable_stdio_uart(opera_mitm 0)
pico_add_extra_outputs(opera_mitm)
