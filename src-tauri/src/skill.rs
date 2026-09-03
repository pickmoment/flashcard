//! 번들된 flashcards 스킬 페이로드를 다룬다.
//!
//! 스킬은 `vendor/flashcards` 를 통째로 바이너리에 넣어 둔다 — 실행 시점에
//! 스킬 디렉토리를 참조하지 않으므로, 사용자 환경에 스킬이 없어도 앱은 완전히
//! 동작하고 오히려 앱이 스킬을 설치하는 쪽이 된다.

use include_dir::{include_dir, Dir};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 컴파일 시점에 통째로 들어간다. 소스 오브 트루스는 `vendor/flashcards` 하나다.
pub static SKILL: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../vendor/flashcards");

const SKILL_NAME: &str = "flashcards";

/// 엔진 파일 — 번들·설치본 양쪽에서 버전을 뽑는 기준이다.
const ENGINE_FILE: &str = "assets/deckcards.js";

/// 필드 이름은 프론트엔드 `SkillStatus` 계약이므로 바꾸지 않는다.
#[derive(Serialize)]
pub struct SkillStatus {
    /// 설치 대상 경로 (…/skills/flashcards)
    pub target: String,
    pub installed: bool,
    /// 번들 파일 수
    pub bundled_files: usize,
    /// 설치본이 번들과 완전히 같은가
    pub up_to_date: bool,
    /// 설치본에 없는 파일
    pub missing: Vec<String>,
    /// 내용이 다른 파일
    pub differing: Vec<String>,
    /// 번들에 없는데 설치본에 있는 파일
    pub extra: Vec<String>,
    pub bundled_version: String,
    pub installed_version: Option<String>,
}

/// 번들 안의 모든 파일을 (상대경로, 내용) 으로 펼친다.
fn walk<'a>(dir: &'a Dir<'a>, out: &mut Vec<(String, &'a [u8])>) {
    for f in dir.files() {
        out.push((f.path().to_string_lossy().replace('\\', "/"), f.contents()));
    }
    for d in dir.dirs() {
        walk(d, out);
    }
}

pub fn bundled_files() -> Vec<(String, &'static [u8])> {
    let mut v = Vec::new();
    walk(&SKILL, &mut v);
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

/// 설치된 디렉토리를 훑어 상대경로 목록을 만든다.
fn walk_disk(root: &Path, base: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name();
        // OS 별 부가 파일은 비교 대상이 아니다
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" || name == "ehthumbs.db" {
            continue;
        }
        if p.is_dir() {
            walk_disk(&p, base, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// `var VERSION = '0.1.0';` 에서 버전을 뽑는다.
fn engine_version(src: &str) -> Option<String> {
    let i = src.find("var VERSION = '")? + "var VERSION = '".len();
    let rest = &src[i..];
    let j = rest.find('\'')?;
    Some(rest[..j].to_string())
}

fn bundled_version() -> String {
    SKILL
        .get_file(ENGINE_FILE)
        .and_then(|f| f.contents_utf8())
        .and_then(engine_version)
        .unwrap_or_else(|| "unknown".into())
}

/// 설치 루트를 정한다.
/// - None / "user-claude" / "claude" -> ~/.claude/skills
/// - "user-agents" / "agents" -> ~/.agents/skills
/// - "claude:<path>" -> <path>/.claude/skills
/// - "agents:<path>" -> <path>/.agents/skills
/// - 기타 직접 경로 -> <path>/.claude/skills 또는 지정된 경로
pub fn skills_root(root: Option<&str>) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 디렉토리를 찾지 못했다".to_string())?;
    match root {
        None | Some("user-claude") | Some("claude") | Some("") => {
            Ok(home.join(".claude").join("skills"))
        }
        Some("user-agents") | Some("agents") => Ok(home.join(".agents").join("skills")),
        Some(s) if s.starts_with("claude:") => {
            let path_part = &s["claude:".len()..];
            Ok(PathBuf::from(path_part).join(".claude").join("skills"))
        }
        Some(s) if s.starts_with("agents:") => {
            let path_part = &s["agents:".len()..];
            Ok(PathBuf::from(path_part).join(".agents").join("skills"))
        }
        Some(custom) => {
            let p = PathBuf::from(custom);
            if p.ends_with("skills") {
                Ok(p)
            } else if p.ends_with(".claude") || p.ends_with(".agents") {
                Ok(p.join("skills"))
            } else {
                Ok(p.join(".claude").join("skills"))
            }
        }
    }
}

/// 번들과 디스크를 파일 단위로 — 내용까지 — 비교한다. 버전 문자열만 보면
/// 사용자가 손댄 설치본을 최신으로 착각한다.
pub fn status(root: Option<&str>) -> Result<SkillStatus, String> {
    let target = skills_root(root)?.join(SKILL_NAME);
    let bundled = bundled_files();
    let bv = bundled_version();

    if !target.is_dir() {
        return Ok(SkillStatus {
            target: target.to_string_lossy().into(),
            installed: false,
            bundled_files: bundled.len(),
            up_to_date: false,
            missing: bundled.iter().map(|(p, _)| p.clone()).collect(),
            differing: vec![],
            extra: vec![],
            bundled_version: bv,
            installed_version: None,
        });
    }

    let mut missing = Vec::new();
    let mut differing = Vec::new();
    for (rel, bytes) in &bundled {
        let p = target.join(rel);
        match std::fs::read(&p) {
            Ok(cur) if cur == *bytes => {}
            Ok(_) => differing.push(rel.clone()),
            Err(_) => missing.push(rel.clone()),
        }
    }

    let mut on_disk = Vec::new();
    walk_disk(&target, &target, &mut on_disk);
    let known: std::collections::HashSet<&str> = bundled.iter().map(|(p, _)| p.as_str()).collect();
    let mut extra: Vec<String> = on_disk
        .into_iter()
        .filter(|p| !known.contains(p.as_str()))
        .collect();
    extra.sort();

    let iv = std::fs::read_to_string(target.join(ENGINE_FILE))
        .ok()
        .as_deref()
        .and_then(engine_version);

    Ok(SkillStatus {
        target: target.to_string_lossy().into(),
        installed: true,
        bundled_files: bundled.len(),
        up_to_date: missing.is_empty() && differing.is_empty(),
        missing,
        differing,
        extra,
        bundled_version: bv,
        installed_version: iv,
    })
}

/// 번들을 대상 경로에 쓴다. 덮어쓰되, 번들에 없는 파일은 건드리지 않는다
/// (사용자가 스킬 폴더에 따로 둔 메모를 지우지 않기 위해서다).
pub fn install(root: Option<&str>) -> Result<SkillStatus, String> {
    let target = skills_root(root)?.join(SKILL_NAME);
    for (rel, bytes) in bundled_files() {
        let p = target.join(&rel);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        std::fs::write(&p, bytes).map_err(|e| format!("{}: {e}", p.display()))?;
    }
    status(root)
}

/// 스킬 디렉토리를 지운다. 안전을 위해 경로 끝이 `skills/flashcards` 일 때만 지운다.
pub fn remove(root: Option<&str>) -> Result<SkillStatus, String> {
    let target = skills_root(root)?.join(SKILL_NAME);
    if !target.is_dir() {
        return status(root);
    }
    let canon = std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    let ok = canon.ends_with(SKILL_NAME)
        && canon.parent().map(|p| p.ends_with("skills")).unwrap_or(false);
    if !ok {
        return Err(format!("예상치 못한 경로라 지우지 않았다: {}", target.display()));
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    status(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 테스트가 사용자의 진짜 `~/.claude/skills` 를 건드리면 안 된다 —
    /// 임시 디렉토리 아래 이 프로세스만 쓰는 이름을 만든다.
    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("flashcard-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    /// 임시 루트에 설치 → 상태 → 변조 감지 → 재설치 → 제거까지 한 바퀴.
    #[test]
    fn install_roundtrip() {
        let root = temp_root("skill");
        let r = root.to_string_lossy().to_string();
        let rs = Some(r.as_str());

        let before = status(rs).unwrap();
        assert!(!before.installed, "아직 설치 전이다");
        assert!(before.bundled_files >= 9, "번들에 스킬 파일이 들어 있어야 한다");
        assert_ne!(before.bundled_version, "unknown", "엔진 버전을 읽어야 한다");

        let after = install(rs).unwrap();
        assert!(after.installed && after.up_to_date, "설치 직후는 최신이어야 한다");
        assert!(after.missing.is_empty() && after.differing.is_empty());
        assert_eq!(
            after.installed_version.as_deref(),
            Some(after.bundled_version.as_str())
        );

        // 스킬이 실제로 동작할 수 있는 형태인지 — 핵심 파일이 있어야 한다
        let target = root.join(".claude/skills/flashcards");
        for f in [
            "SKILL.md",
            "assets/deckcards.js",
            "assets/fc.js",
            "references/base.html",
        ] {
            assert!(target.join(f).is_file(), "{f} 가 없다");
        }

        // 사용자가 따로 둔 파일은 설치가 건드리지 않는다
        std::fs::write(target.join("MEMO.txt"), "내 메모").unwrap();
        std::fs::write(target.join("SKILL.md"), "변조").unwrap();
        let dirty = status(rs).unwrap();
        assert!(!dirty.up_to_date);
        assert_eq!(dirty.differing, vec!["SKILL.md".to_string()]);
        assert_eq!(dirty.extra, vec!["MEMO.txt".to_string()]);

        // 엔진을 지우면 missing 으로 잡히고 설치 버전도 사라진다
        std::fs::remove_file(target.join(ENGINE_FILE)).unwrap();
        let broken = status(rs).unwrap();
        assert_eq!(broken.missing, vec![ENGINE_FILE.to_string()]);
        assert!(broken.installed_version.is_none());

        let fixed = install(rs).unwrap();
        assert!(fixed.up_to_date, "재설치가 변조를 되돌려야 한다");
        assert!(target.join("MEMO.txt").is_file(), "번들 밖 파일은 남아야 한다");

        let gone = remove(rs).unwrap();
        assert!(!gone.installed);
        assert!(!target.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// `.agents` 계열 루트도 같은 왕복이 돌아야 한다.
    #[test]
    fn install_agents_roundtrip() {
        let root = temp_root("agents");
        let req = format!("agents:{}", root.to_string_lossy());
        let rs = Some(req.as_str());

        let before = status(rs).unwrap();
        assert!(!before.installed);
        assert!(before.target.contains(".agents"));

        let after = install(rs).unwrap();
        assert!(after.installed && after.up_to_date);
        let target = root.join(".agents/skills/flashcards");
        assert!(target.join("SKILL.md").is_file());

        let gone = remove(rs).unwrap();
        assert!(!gone.installed);
        assert!(!target.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 루트 지정 규칙이 프론트엔드가 보내는 형태들을 모두 받아야 한다.
    #[test]
    fn skills_root_forms() {
        let home = dirs::home_dir().unwrap();
        for k in [None, Some("user-claude"), Some("claude"), Some("")] {
            assert_eq!(skills_root(k).unwrap(), home.join(".claude/skills"));
        }
        for k in [Some("user-agents"), Some("agents")] {
            assert_eq!(skills_root(k).unwrap(), home.join(".agents/skills"));
        }
        assert_eq!(
            skills_root(Some("claude:/tmp/ws")).unwrap(),
            PathBuf::from("/tmp/ws/.claude/skills")
        );
        assert_eq!(
            skills_root(Some("agents:/tmp/ws")).unwrap(),
            PathBuf::from("/tmp/ws/.agents/skills")
        );
        // 사용자가 폴더 고르기로 넘긴 경로 — 이미 skills 면 그대로 쓴다
        assert_eq!(
            skills_root(Some("/tmp/ws/.claude/skills")).unwrap(),
            PathBuf::from("/tmp/ws/.claude/skills")
        );
        assert_eq!(
            skills_root(Some("/tmp/ws/.agents")).unwrap(),
            PathBuf::from("/tmp/ws/.agents/skills")
        );
        assert_eq!(
            skills_root(Some("/tmp/ws")).unwrap(),
            PathBuf::from("/tmp/ws/.claude/skills")
        );
    }
}
