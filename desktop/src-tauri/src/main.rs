// NotifyHub desktop: a native window around the NotifyHub web app.
//
// The window starts on the bundled start page (desktop/src/index.html), which connects to the
// NotifyHub server and then navigates to it. The app never talks to the database itself:
// the server (Render or `npm start` on this PC) stays the only thing holding DATABASE_URL.

// Hide the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, Url};

/// Address of the bundled start page, with `?change=1` so it shows the server picker.
fn start_page() -> Url {
    #[cfg(windows)]
    let url = "http://tauri.localhost/index.html?change=1";
    #[cfg(not(windows))]
    let url = "tauri://localhost/index.html?change=1";
    url.parse().expect("valid start page URL")
}

fn main() {
    tauri::Builder::default()
        .menu(|app| {
            let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let change = MenuItem::with_id(app, "change", "Change server...", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
            let file = Submenu::with_items(
                app,
                "NotifyHub",
                true,
                &[&reload, &change, &PredefinedMenuItem::separator(app)?, &quit],
            )?;
            Menu::with_items(app, &[&file])
        })
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else { return };
            match event.id().as_ref() {
                "reload" => {
                    let _ = window.eval("location.reload()");
                }
                "change" => {
                    let _ = window.navigate(start_page());
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NotifyHub");
}
