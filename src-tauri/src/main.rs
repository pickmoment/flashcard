// 릴리스 빌드에서 콘솔 창이 따라 뜨지 않게 한다 (윈도우)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flashcard_lib::run()
}
