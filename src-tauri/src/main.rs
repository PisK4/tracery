// 桌面外壳：只开一个窗口指向本机采集器，不托管服务进程。
// 采集器由 launchd KeepAlive 管理；外壳再起一个会双写、双扫、抢同一个 SQLite 库。
// 权限最小：capability 只给主窗口核心能力，页面拿不到 fs/shell/IPC。

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 与采集器共用 ATC_PORT，默认 8320；页面用 `?host=desktop` 进桌面样式。
fn port_from_env() -> u16 {
    std::env::var("ATC_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse().ok())
        .unwrap_or(8320)
}

fn service_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/?host=desktop")
}

/// 400ms 内能连上 loopback 端口就算服务在跑；不探测就直接加载会得到浏览器的网络错误页。
fn reachable(port: u16) -> bool {
    use std::net::{Ipv4Addr, SocketAddr, TcpStream};
    use std::time::Duration;
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let port = port_from_env();
            // 服务不在时加载内嵌失败页：给重试与启动提示，不代为启动采集器。
            // 端口用初始化脚本传入，失败页据此重试；不靠 URL 查询串（app 协议上不可靠）。
            let url = if reachable(port) {
                WebviewUrl::External(service_url(port).parse()?)
            } else {
                WebviewUrl::App("index.html".into())
            };
            #[allow(unused_mut)]
            let mut builder = WebviewWindowBuilder::new(app, "main", url)
                .title("Tracery")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1180.0, 760.0)
                .initialization_script(format!("window.__ATC_PORT__ = '{port}';"));
            // overlay 标题栏：内容铺到窗口顶部，原生交通灯压在顶栏的 78px 留白里。
            // 不启用远程页面 IPC，所以整条顶栏不能靠 data-tauri-drag-region 拖动；
            // 原生标题栏那一条仍可拖，页面里的属性留给以后放开 IPC 时生效。
            #[cfg(target_os = "macos")]
            {
                use tauri::{LogicalPosition, TitleBarStyle};
                builder = builder
                    .title_bar_style(TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(LogicalPosition::new(18.0, 17.0));
            }
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tracery shell failed to start");
}
