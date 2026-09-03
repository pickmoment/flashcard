mod skill;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
struct FileInfo {
    path: String,
    name: String,
}

/// 텍스트 파일을 읽는다 (덱 스펙 JSON · 가져올 표·목록).
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// 텍스트 파일을 쓴다 (덱 스펙 JSON · 산출물 HTML · CSV).
#[tauri::command]
fn write_text(path: String, contents: String) -> Result<FileInfo, String> {
    let p = PathBuf::from(&path);
    /* 저장 다이얼로그로 새 폴더 이름을 직접 타이핑할 수 있다 — 부모가 없으면 만든다 */
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&p, contents).map_err(|e| format!("{path}: {e}"))?;
    Ok(FileInfo {
        name: p
            .file_name()
            .map(|s| s.to_string_lossy().into())
            .unwrap_or_default(),
        path,
    })
}

/// 확장자로 이미지 mime 을 고른다. 모르는 확장자는 브라우저가 스니핑하도록
/// `application/octet-stream` 으로 두고, 대신 로그를 남겨 그림이 안 뜰 때
/// 원인을 찾을 수 있게 한다.
fn image_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// 이미지를 data URI 로 읽는다 — 카드에 그림을 심어 산출물 HTML 한 장으로
/// 오프라인에서도 보이게 한다.
#[tauri::command]
fn read_data_uri(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let ext = PathBuf::from(&path)
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = image_mime(&ext);
    if mime == "application/octet-stream" {
        log::warn!("이미지 형식을 모르는 확장자다 ({ext:?}): {path}");
    }
    Ok(format!("data:{mime};base64,{}", b64(&bytes)))
}

/// 의존성 없는 표준 base64.
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18 & 63) as usize] as char);
        out.push(T[(n >> 12 & 63) as usize] as char);
        out.push(if c.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// 파일 크기 — 이미지를 data URI 로 심기 전에 산출물이 얼마나 커지는지 보여준다.
#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("{path}: {e}"))
}

/**
 * 파일을 기본 앱으로 연다.
 *
 * 프런트엔드에서 opener 플러그인의 `open_path` 를 직접 부르면 ACL 스코프에 걸린다 —
 * `allow-open-path` 만 주면 허용 목록이 비어 `is_path_allowed` 가 항상 false 다.
 * 경로는 네이티브 저장 다이얼로그로 사용자가 직접 고르고 우리가 방금 쓴 파일이라,
 * 임의 경로를 웹 콘텐츠가 넘기는 상황이 아니다. 그래서 스코프를 넓히는 대신
 * Rust 쪽 API 로 연다 — 넓은 와일드카드 스코프를 남기지 않는다.
 */
#[tauri::command]
fn open_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !PathBuf::from(&path).is_file() {
        return Err(format!("파일이 없다: {path}"));
    }
    app.opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|e| format!("{path}: {e}"))
}

/// 파일을 파인더에서 보여준다.
#[tauri::command]
fn reveal_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("{path}: {e}"))
}

/// 임시 파일 경로. 산출물 HTML 을 여기 써 두고 브라우저로 열어 본다.
/// 이름에 경로 구분자나 상위 참조가 섞이면 임시 디렉토리 밖으로 나가므로 거부한다.
#[tauri::command]
fn temp_path(name: String) -> Result<String, String> {
    let p = std::path::Path::new(&name);
    if p.components().count() != 1
        || matches!(p.components().next(), Some(std::path::Component::ParentDir))
    {
        return Err(format!("잘못된 임시 파일 이름: {name}"));
    }
    Ok(std::env::temp_dir().join(name).to_string_lossy().into())
}

/// 임시 파일 치우기. 없으면 조용히 넘어간다.
#[tauri::command]
fn remove_file(path: String) {
    let _ = std::fs::remove_file(path);
}

#[tauri::command]
fn home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().into())
}

/// 앱 전용 데이터 디렉토리 — 자동저장 스냅샷을 여기 둔다. 없으면 만든다.
#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into())
}

/// 앱 로그 디렉토리 — `tauri-plugin-log` 가 여기 로그 파일을 남긴다.
#[tauri::command]
fn app_log_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into())
}

#[tauri::command]
fn skill_status(root: Option<String>) -> Result<skill::SkillStatus, String> {
    skill::status(root.as_deref())
}

#[tauri::command]
fn skill_install(root: Option<String>) -> Result<skill::SkillStatus, String> {
    skill::install(root.as_deref())
}

#[tauri::command]
fn skill_remove(root: Option<String>) -> Result<skill::SkillStatus, String> {
    skill::remove(root.as_deref())
}

/// 번들 안의 파일 하나를 텍스트로 꺼낸다 — 앱 안에서 레퍼런스 문서를 읽을 때 쓴다.
#[tauri::command]
fn skill_file(path: String) -> Result<String, String> {
    skill::SKILL
        .get_file(&path)
        .and_then(|f| f.contents_utf8())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("번들에 없는 파일: {path}"))
}

/// 번들에 든 파일 목록.
#[tauri::command]
fn skill_manifest() -> Vec<String> {
    skill::bundled_files().into_iter().map(|(p, _)| p).collect()
}

/**
 * 앱을 띄운다.
 *
 * `tauri.conf.json` 의 CSP 는 미리보기가 도는 조건이라 임의로 좁힐 수 없다.
 * JSON 에는 주석을 달 수 없으니 근거를 여기 남긴다:
 *
 * - 미리보기는 산출물 HTML 을 blob iframe 에 띄운다. blob 문서는 자기 CSP 헤더가
 *   없어 부모 문서의 CSP 를 그대로 물려받는데, 산출물의 스크립트는 전부 인라인이다.
 *   그래서 `script-src` 에 `'unsafe-inline'` 과 `'unsafe-eval'`, `frame-src` 에
 *   `blob:` 이 필요하다. 없으면 미리보기 iframe 이 백지로 뜬다.
 * - `dangerousDisableAssetCspModification: ["script-src"]` 가 함께 있어야 한다.
 *   Tauri 는 자기 부트스트랩 인라인 스크립트의 sha256 해시를 `script-src` 에
 *   덧붙이는데, CSP 규칙상 해시나 nonce 가 하나라도 있으면 `'unsafe-inline'` 은
 *   무시된다 — 즉 해시를 덧붙이는 순간 산출물의 인라인 스크립트가 전부 막힌다.
 *   그래서 `script-src` 만 Tauri 의 자동 수정 대상에서 뺀다.
 * - `https://cdn.jsdelivr.net` 을 script/style/font 에 허용한다. 산출물이
 *   Pretendard 폰트와 mermaid 를 CDN 에서 받기 때문이다 — 미리보기가 실제
 *   산출물과 같은 그림이어야 하므로 여기서 막으면 검수 자체가 틀어진다.
 * - `img-src` 에 `data:` 가 필요하다. 카드 이미지는 data URI 로 심긴다.
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("flashcard".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            read_data_uri,
            file_size,
            open_file,
            reveal_file,
            home_dir,
            temp_path,
            remove_file,
            skill_status,
            skill_install,
            skill_remove,
            skill_file,
            skill_manifest,
            app_data_dir,
            app_log_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// base64 는 직접 구현했으므로 알려진 값으로 확인한다.
    #[test]
    fn b64_known_vectors() {
        assert_eq!(super::b64(b""), "");
        assert_eq!(super::b64(b"f"), "Zg==");
        assert_eq!(super::b64(b"fo"), "Zm8=");
        assert_eq!(super::b64(b"foo"), "Zm9v");
        assert_eq!(super::b64(b"foob"), "Zm9vYg==");
        assert_eq!(super::b64(b"fooba"), "Zm9vYmE=");
        assert_eq!(super::b64(b"foobar"), "Zm9vYmFy");
        /* 바이트 전 범위 — 62·63번 문자(+ /)가 나오는 조합을 포함한다 */
        let all: Vec<u8> = (0u8..=255).collect();
        let enc = super::b64(&all);
        assert_eq!(enc.len(), (256 + 2) / 3 * 4);
        assert!(enc.contains('+') && enc.contains('/'), "62·63번 문자가 나와야 한다");
        assert!(enc.chars().all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c)));
    }

    #[test]
    fn image_mime_map() {
        assert_eq!(super::image_mime("png"), "image/png");
        assert_eq!(super::image_mime("jpg"), "image/jpeg");
        assert_eq!(super::image_mime("jpeg"), "image/jpeg");
        assert_eq!(super::image_mime("webp"), "image/webp");
        assert_eq!(super::image_mime("gif"), "image/gif");
        assert_eq!(super::image_mime("avif"), "image/avif");
        assert_eq!(super::image_mime("svg"), "image/svg+xml");
        assert_eq!(super::image_mime("bmp"), "image/bmp");
        /* 모르는 확장자는 추측하지 않는다 */
        assert_eq!(super::image_mime("mp3"), "application/octet-stream");
        assert_eq!(super::image_mime(""), "application/octet-stream");
    }

    /// 확장자를 mime 으로 옮기고 본문을 base64 로 붙이는 전체 경로를 확인한다.
    #[test]
    fn read_data_uri_image() {
        let dir = std::env::temp_dir().join(format!("flashcard-uri-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let png = dir.join("Q.PNG"); /* 확장자 대소문자를 섞어도 잡아야 한다 */
        std::fs::write(&png, b"foobar").unwrap();
        assert_eq!(
            super::read_data_uri(png.to_string_lossy().into()).unwrap(),
            "data:image/png;base64,Zm9vYmFy"
        );

        let odd = dir.join("note.xyz");
        std::fs::write(&odd, b"foo").unwrap();
        assert_eq!(
            super::read_data_uri(odd.to_string_lossy().into()).unwrap(),
            "data:application/octet-stream;base64,Zm9v"
        );

        assert!(
            super::read_data_uri(dir.join("없는파일.png").to_string_lossy().into()).is_err(),
            "없는 파일은 오류여야 한다"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 임시 경로 이름은 임시 디렉토리 밖으로 나갈 수 없어야 한다.
    #[test]
    fn temp_path_rejects_traversal() {
        assert!(super::temp_path("deck-preview.html".into()).is_ok());
        for bad in ["../deck.html", "a/b.html", "/etc/passwd", "..", ""] {
            assert!(super::temp_path(bad.into()).is_err(), "{bad} 를 거부해야 한다");
        }
    }
}
