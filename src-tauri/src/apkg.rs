//! Anki 패키지(.apkg) 읽기.
//!
//! .apkg 는 zip 이고 안에 sqlite 컬렉션 하나와 `media` 목록, 그리고 "0","1",…
//! 이름의 미디어 파일이 들어 있다. 세 세대가 공존한다:
//!
//! - `collection.anki2`   — 스키마 11, 노트 타입·덱이 `col` 테이블의 JSON 컬럼
//! - `collection.anki21`  — 같은 스키마 11 (Anki 2.1 의 레거시 내보내기)
//! - `collection.anki21b` — 스키마 18, 노트 타입·덱이 별도 테이블, 파일 전체가
//!   zstd 로 감싸져 있고 `media` 목록은 protobuf, 미디어 파일도 각각 zstd
//!
//! 여기서는 노트의 필드를 HTML 그대로 꺼내고 이미지만 data URI 로 만든다.
//! HTML → markdown 변환은 엔진(`FCD.ankiHtml`)이 맡는다 — 카드 문법을 아는
//! 쪽이 거기이기 때문이다.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

/// 필드 이름은 프론트엔드 `ApkgImport` 계약이므로 바꾸지 않는다.
#[derive(Serialize, Debug)]
pub struct ApkgImport {
    pub deck_name: Option<String>,
    pub notetypes: Vec<Notetype>,
    pub notes: Vec<Note>,
    /// 미디어 파일명 → data URI. 이미지만 담는다.
    pub media: HashMap<String, String>,
    /// 이미지가 아니라 뺀 미디어 개수 (소리·영상 등).
    pub skipped_media: u32,
    pub format: &'static str,
}

#[derive(Serialize, Debug)]
pub struct Notetype {
    /// Anki 모델 id 를 십진수 문자열로. `Note::notetype` 과 같은 값이다.
    pub id: String,
    pub name: String,
    /// `ord` 순서 — 노트의 `fields` 와 자리가 맞는다.
    pub fields: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct Note {
    /// `Notetype::id`. 이름이 아니라 id 로 매칭한다 — 이름은 겹칠 수 있다.
    pub notetype: String,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

/// 컬렉션 파일 후보. 최신 것을 먼저 고른다 — 한 패키지에 둘 이상 들어 있는
/// 경우(구버전 호환용 anki2 를 함께 넣던 시절) 최신 것이 원본이다.
const COLLECTIONS: [(&str, &str); 3] = [
    ("collection.anki21b", "anki21b"),
    ("collection.anki21", "anki21"),
    ("collection.anki2", "anki2"),
];

/// Anki 필드 구분자.
const FIELD_SEP: char = '\x1f';

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];

/// 열려 있는 동안만 살고 끝나면 지워지는 임시 파일. 오류로 일찍 빠져도 지운다.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub fn read(path: &str) -> Result<ApkgImport, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("{path}: zip 으로 열 수 없다 ({e})"))?;

    let (name, format) = COLLECTIONS
        .iter()
        .copied()
        .find(|(n, _)| zip.index_for_name(n).is_some())
        .ok_or_else(|| format!("{path}: Anki 컬렉션(collection.anki2*)이 들어 있지 않다"))?;
    let mut bytes = entry(&mut zip, name).map_err(|e| format!("{path}: {e}"))?;
    if format == "anki21b" {
        bytes = zstd::decode_all(&bytes[..])
            .map_err(|e| format!("{path}: {name} zstd 해제 실패 ({e})"))?;
    }

    /* sqlite 는 파일 경로로만 열린다 — 메모리 DB 에 deserialize 하는 길은
    rusqlite 의 선택 기능이고 bundled sqlite 에 그 심볼이 항상 있진 않다 */
    let tmp = TempFile(std::env::temp_dir().join(format!(
        "flashcard-apkg-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )));
    std::fs::write(&tmp.0, &bytes).map_err(|e| format!("{path}: 임시 파일 쓰기 실패 ({e})"))?;
    let conn = Connection::open_with_flags(
        &tmp.0,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("{path}: 컬렉션을 sqlite 로 열 수 없다 ({e})"))?;

    let modern = has_table(&conn, "notetypes").map_err(|e| format!("{path}: {e}"))?;
    let notetypes = if modern { notetypes_from_tables(&conn) } else { notetypes_from_json(&conn) }
        .map_err(|e| format!("{path}: 노트 타입 읽기 실패 ({e})"))?;
    let deck_name = if modern { deck_from_table(&conn) } else { deck_from_json(&conn) }
        .map_err(|e| format!("{path}: 덱 이름 읽기 실패 ({e})"))?;
    let notes = notes(&conn).map_err(|e| format!("{path}: 노트 읽기 실패 ({e})"))?;
    drop(conn);

    let (media, skipped_media) = media(&mut zip).map_err(|e| format!("{path}: {e}"))?;
    log::info!(
        "apkg 읽음 ({format}): 노트 {}, 노트 타입 {}, 이미지 {}, 제외 미디어 {}: {path}",
        notes.len(),
        notetypes.len(),
        media.len(),
        skipped_media
    );

    Ok(ApkgImport { deck_name, notetypes, notes, media, skipped_media, format })
}

fn entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Vec<u8>, String> {
    let mut f = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
    let mut out = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut out).map_err(|e| format!("{name}: {e}"))?;
    Ok(out)
}

/// 스키마 판별은 테이블 존재로 한다. `col.ver` 는 믿기 어렵다 — 레거시
/// 내보내기는 스키마를 11 로 내리면서도 ver 값을 그대로 두는 버전이 있었다.
/// 결국 질의가 성립하는지가 기준이고, 그것이 곧 테이블이 있는지다.
fn has_table(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

fn col_json(conn: &Connection, column: &str) -> rusqlite::Result<serde_json::Value> {
    let raw: String = conn.query_row(&format!("SELECT {column} FROM col LIMIT 1"), [], |r| r.get(0))?;
    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
}

/// 스키마 11: `col.models` = `{ "<mid>": { name, flds: [{ name, ord }] } }`.
fn notetypes_from_json(conn: &Connection) -> rusqlite::Result<Vec<Notetype>> {
    let models = col_json(conn, "models")?;
    let Some(map) = models.as_object() else { return Ok(Vec::new()) };
    let mut out: Vec<Notetype> = map
        .iter()
        .map(|(id, m)| {
            let mut flds: Vec<(i64, String)> = m["flds"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|f| (f["ord"].as_i64().unwrap_or(0), str_of(&f["name"])))
                        .collect()
                })
                .unwrap_or_default();
            flds.sort_by_key(|(ord, _)| *ord);
            Notetype {
                id: id.clone(),
                name: str_of(&m["name"]),
                fields: flds.into_iter().map(|(_, n)| n).collect(),
            }
        })
        .collect();
    /* JSON 맵 순서는 우연이다 — id 순으로 고정한다 */
    out.sort_by_key(|n| n.id.parse::<i64>().unwrap_or(i64::MAX));
    Ok(out)
}

/// 스키마 18: `notetypes(id, name)` + `fields(ntid, ord, name)`.
fn notetypes_from_tables(conn: &Connection) -> rusqlite::Result<Vec<Notetype>> {
    let mut fields: HashMap<i64, Vec<(i64, String)>> = HashMap::new();
    let mut st = conn.prepare("SELECT ntid, ord, name FROM fields")?;
    for row in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))? {
        let (ntid, ord, name) = row?;
        fields.entry(ntid).or_default().push((ord, name));
    }
    let mut st = conn.prepare("SELECT id, name FROM notetypes ORDER BY id")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name) = row?;
        let mut flds = fields.remove(&id).unwrap_or_default();
        flds.sort_by_key(|(ord, _)| *ord);
        out.push(Notetype { id: id.to_string(), name, fields: flds.into_iter().map(|(_, n)| n).collect() });
    }
    Ok(out)
}

/// 덱 이름 하나를 고른다. Anki 는 항상 "Default"(id 1) 를 두므로 그것 말고
/// 사용자가 지은 이름이 있으면 그쪽이다. 하위 덱 구분자는 `::` 로 통일한다.
fn pick_deck(mut names: Vec<(i64, String)>) -> Option<String> {
    names.sort_by_key(|(id, _)| *id);
    let names: Vec<String> = names.into_iter().map(|(_, n)| n.replace(FIELD_SEP, "::")).collect();
    names.iter().find(|n| *n != "Default").or(names.first()).cloned()
}

fn deck_from_json(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let decks = col_json(conn, "decks")?;
    let Some(map) = decks.as_object() else { return Ok(None) };
    Ok(pick_deck(
        map.iter()
            .map(|(id, d)| (id.parse::<i64>().unwrap_or(i64::MAX), str_of(&d["name"])))
            .filter(|(_, n)| !n.is_empty())
            .collect(),
    ))
}

fn deck_from_table(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let mut st = conn.prepare("SELECT id, name FROM decks")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    Ok(pick_deck(rows.collect::<rusqlite::Result<Vec<_>>>()?))
}

fn notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut st = conn.prepare("SELECT mid, flds, tags FROM notes ORDER BY id")?;
    let rows = st.query_map([], |r| {
        Ok(Note {
            notetype: r.get::<_, i64>(0)?.to_string(),
            fields: r.get::<_, String>(1)?.split(FIELD_SEP).map(str::to_owned).collect(),
            tags: r.get::<_, String>(2)?.split_whitespace().map(str::to_owned).collect(),
        })
    })?;
    rows.collect()
}

fn str_of(v: &serde_json::Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

/// `media` 목록을 (zip 안 파일명 → 원래 이름) 으로 푼 뒤 이미지만 data URI 로 만든다.
/// 목록 형식은 내용으로 가른다 — 컬렉션 형식과 같이 움직이지만 zstd 매직 네 바이트를
/// 보는 편이 어떤 조합의 패키지에도 맞는다.
fn media(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<(HashMap<String, String>, u32), String> {
    let mut media = HashMap::new();
    let mut skipped = 0u32;
    if zip.index_for_name("media").is_none() {
        return Ok((media, skipped));
    }
    let raw = entry(zip, "media")?;
    let compressed = raw.starts_with(&ZSTD_MAGIC);
    let names: Vec<(String, String)> = if compressed {
        let buf = zstd::decode_all(&raw[..]).map_err(|e| format!("media 목록 zstd 해제 실패 ({e})"))?;
        media_entries(&buf)
            .ok_or("media 목록(protobuf)이 깨져 있다")?
            .into_iter()
            .enumerate()
            .map(|(i, n)| (i.to_string(), n))
            .collect()
    } else {
        let json: serde_json::Value =
            serde_json::from_slice(&raw).map_err(|e| format!("media 목록(JSON)이 깨져 있다 ({e})"))?;
        json.as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), str_of(v))).collect())
            .unwrap_or_default()
    };

    for (key, name) in names {
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        let mime = crate::image_mime(&ext);
        if mime == "application/octet-stream" {
            skipped += 1;
            continue;
        }
        let mut bytes = match entry(zip, &key) {
            Ok(b) => b,
            Err(e) => {
                /* 목록엔 있는데 파일이 빠진 패키지가 실제로 돌아다닌다 — 한 장 때문에
                전체를 실패시키지 않고 없는 것으로 친다 */
                log::warn!("미디어 {name}({key}) 를 꺼낼 수 없다: {e}");
                skipped += 1;
                continue;
            }
        };
        if compressed {
            bytes = zstd::decode_all(&bytes[..]).map_err(|e| format!("미디어 {name} zstd 해제 실패 ({e})"))?;
        }
        media.insert(name, format!("data:{mime};base64,{}", crate::b64(&bytes)));
    }
    Ok((media, skipped))
}

/* ---- protobuf 손 디코더 -------------------------------------------------
 * anki21b 의 media 목록:
 *   message MediaEntries { repeated MediaEntry entries = 1; }
 *   message MediaEntry   { string name = 1; uint32 size = 2; bytes sha1 = 3; }
 * name 만 필요하다. 이 두 메시지에 크레이트를 들이는 대신 varint 와
 * length-delimited 만 읽고 나머지 wire type 은 규격대로 건너뛴다.
 * 순서가 곧 zip 안의 파일명("0","1",…)이므로 빈 이름도 자리는 지켜야 한다. */

fn varint(buf: &[u8], pos: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *buf.get(*pos)?;
        *pos += 1;
        v |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

/// 필드 하나를 읽어 (field number, 값 슬라이스) 를 준다. length-delimited 가
/// 아닌 값은 슬라이스가 그 원시 바이트다 — 여기서는 어차피 버린다.
fn field<'a>(buf: &'a [u8], pos: &mut usize) -> Option<(u64, &'a [u8])> {
    let key = varint(buf, pos)?;
    let start = *pos;
    match key & 7 {
        0 => {
            varint(buf, pos)?;
        }
        1 => *pos += 8,
        2 => {
            let len = varint(buf, pos)? as usize;
            let s = *pos;
            *pos = s.checked_add(len)?;
            if *pos > buf.len() {
                return None;
            }
            return Some((key >> 3, &buf[s..*pos]));
        }
        5 => *pos += 4,
        _ => return None,
    }
    if *pos > buf.len() {
        return None;
    }
    Some((key >> 3, &buf[start..*pos]))
}

fn media_entries(buf: &[u8]) -> Option<Vec<String>> {
    let mut names = Vec::new();
    let mut pos = 0;
    while pos < buf.len() {
        let (num, val) = field(buf, &mut pos)?;
        if num == 1 {
            names.push(media_entry_name(val)?);
        }
    }
    Some(names)
}

fn media_entry_name(buf: &[u8]) -> Option<String> {
    let mut name = String::new();
    let mut pos = 0;
    while pos < buf.len() {
        let (num, val) = field(buf, &mut pos)?;
        if num == 1 {
            name = String::from_utf8_lossy(val).into_owned();
        }
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 1x1 PNG — 헤더만 맞으면 된다, 브라우저에 보여줄 것이 아니다.
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("flashcard-apkg-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_zip(path: &PathBuf, entries: &[(&str, &[u8])]) {
        let mut w = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            w.start_file(*name, opt).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap();
    }

    fn legacy_db(path: &PathBuf) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE col (id INTEGER PRIMARY KEY, ver INTEGER, models TEXT, decks TEXT);
             CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);",
        )
        .unwrap();
        let models = serde_json::json!({
            "1700000000001": { "name": "Basic", "flds": [ { "name": "Back", "ord": 1 }, { "name": "Front", "ord": 0 } ] },
            "1700000000002": { "name": "Cloze", "flds": [ { "name": "Text", "ord": 0 }, { "name": "Extra", "ord": 1 } ] }
        });
        let decks = serde_json::json!({
            "1": { "name": "Default" },
            "1700000000009": { "name": "경제::기초" }
        });
        conn.execute(
            "INSERT INTO col (id, ver, models, decks) VALUES (1, 11, ?1, ?2)",
            [models.to_string(), decks.to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, mid, flds, tags) VALUES (1, 1700000000002, ?1, ?2)",
            ["{{c1::수요}}가 늘면 가격이 오른다\x1f", " econ  basic "],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, mid, flds, tags) VALUES (2, 1700000000001, ?1, '')",
            ["<img src=\"a.png\"><br>그래프\x1f<b>우상향</b>"],
        )
        .unwrap();
    }

    fn modern_db(path: &PathBuf) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE col (id INTEGER PRIMARY KEY, ver INTEGER);
             INSERT INTO col VALUES (1, 18);
             CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT);
             CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
             INSERT INTO notetypes VALUES (42, 'Basic');
             INSERT INTO fields VALUES (42, 1, 'Back'), (42, 0, 'Front');
             INSERT INTO decks VALUES (1, 'Default'), (7, '역사\x1f근대');
             INSERT INTO notes VALUES (1, 42, '앞\x1f뒤 <img src=\"b.jpg\">', ' hist ');",
        )
        .unwrap();
    }

    /// 스키마 11 패키지 — 레거시 JSON media 목록, 압축 없는 sqlite.
    #[test]
    fn read_legacy_package() {
        let dir = temp_dir("legacy");
        let db = dir.join("collection.anki2");
        legacy_db(&db);
        let apkg = dir.join("deck.apkg");
        write_zip(
            &apkg,
            &[
                ("collection.anki2", &std::fs::read(&db).unwrap()),
                ("media", br#"{"0":"a.png","1":"voice.mp3"}"#),
                ("0", PNG),
                ("1", b"ID3"),
            ],
        );

        let got = read(apkg.to_str().unwrap()).unwrap();
        assert_eq!(got.format, "anki2");
        assert_eq!(got.deck_name.as_deref(), Some("경제::기초"), "Default 보다 사용자 덱을 고른다");

        assert_eq!(got.notetypes.len(), 2);
        let basic = got.notetypes.iter().find(|n| n.name == "Basic").unwrap();
        assert_eq!(basic.id, "1700000000001");
        assert_eq!(basic.fields, ["Front", "Back"], "ord 순으로 정렬해야 한다");

        assert_eq!(got.notes.len(), 2);
        assert_eq!(got.notes[0].notetype, "1700000000002");
        assert_eq!(got.notes[0].fields, ["{{c1::수요}}가 늘면 가격이 오른다", ""]);
        assert_eq!(got.notes[0].tags, ["econ", "basic"]);
        assert_eq!(got.notes[1].fields[0], "<img src=\"a.png\"><br>그래프");
        assert!(got.notes[1].tags.is_empty());

        assert_eq!(got.media.len(), 1);
        assert_eq!(got.media["a.png"], format!("data:image/png;base64,{}", crate::b64(PNG)));
        assert_eq!(got.skipped_media, 1, "mp3 는 세기만 한다");

        assert!(
            !std::fs::read_dir(std::env::temp_dir())
                .unwrap()
                .flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with(&format!("flashcard-apkg-{}-", std::process::id()))),
            "임시 sqlite 를 지워야 한다"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 스키마 18 패키지 — zstd 컬렉션, protobuf media 목록, zstd 미디어.
    #[test]
    fn read_modern_package() {
        let dir = temp_dir("modern");
        let db = dir.join("collection.sqlite");
        modern_db(&db);
        let col = zstd::encode_all(&std::fs::read(&db).unwrap()[..], 3).unwrap();
        /* MediaEntries { entries: [ { name:"b.jpg", size:5, sha1:"xx" }, { name:"clip.mp3" } ] } */
        let mut entries = Vec::new();
        entries.extend_from_slice(&[0x0a, 13, 0x0a, 5, b'b', b'.', b'j', b'p', b'g', 0x10, 5, 0x1a, 2, b'x', b'x']);
        entries.extend_from_slice(&[0x0a, 10, 0x0a, 8]);
        entries.extend_from_slice(b"clip.mp3");
        let media_list = zstd::encode_all(&entries[..], 3).unwrap();
        let jpg = zstd::encode_all(&b"\xff\xd8\xff"[..], 3).unwrap();
        let apkg = dir.join("deck.apkg");
        write_zip(
            &apkg,
            &[
                ("collection.anki21b", &col),
                ("collection.anki2", b"placeholder"), /* 최신 것을 골라야 한다 */
                ("media", &media_list),
                ("0", &jpg),
                ("1", b"ID3"),
            ],
        );

        let got = read(apkg.to_str().unwrap()).unwrap();
        assert_eq!(got.format, "anki21b");
        assert_eq!(got.deck_name.as_deref(), Some("역사::근대"), "\\x1f 구분자를 :: 로 바꾼다");
        assert_eq!(got.notetypes.len(), 1);
        assert_eq!(got.notetypes[0].id, "42");
        assert_eq!(got.notetypes[0].fields, ["Front", "Back"]);
        assert_eq!(got.notes.len(), 1);
        assert_eq!(got.notes[0].notetype, "42");
        assert_eq!(got.notes[0].tags, ["hist"]);
        assert_eq!(got.media["b.jpg"], format!("data:image/jpeg;base64,{}", crate::b64(b"\xff\xd8\xff")));
        assert_eq!(got.skipped_media, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_apkg() {
        let dir = temp_dir("bad");
        let txt = dir.join("x.apkg");
        std::fs::write(&txt, b"not a zip").unwrap();
        let err = read(txt.to_str().unwrap()).unwrap_err();
        assert!(err.contains("x.apkg"), "오류에 경로가 있어야 한다: {err}");

        let empty = dir.join("empty.apkg");
        write_zip(&empty, &[("readme.txt", b"hi")]);
        let err = read(empty.to_str().unwrap()).unwrap_err();
        assert!(err.contains("컬렉션"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 손으로 인코딩한 바이트로 디코더를 확인한다. 이름 외 필드(varint size,
    /// bytes sha1)와 모르는 fixed64/fixed32 필드를 건너뛰어야 한다.
    #[test]
    fn protobuf_media_entries() {
        let buf: Vec<u8> = vec![
            /* entry 0: name="a.png" size=300 sha1=[1,2] */
            0x0a, 14, 0x0a, 5, b'a', b'.', b'p', b'n', b'g', 0x10, 0xac, 0x02, 0x1a, 2, 1, 2,
            /* entry 1: size 만, 이름 없음 — 자리는 지켜야 한다 */
            0x0a, 2, 0x10, 7,
            /* 모르는 필드 9 (fixed64), 10 (fixed32) */
            0x49, 0, 0, 0, 0, 0, 0, 0, 0, 0x55, 0, 0, 0, 0,
            /* entry 2: name="한.gif" */
            0x0a, 10, 0x0a, 8, 0xed, 0x95, 0x9c, b'.', b'g', b'i', b'f', b'!',
        ];
        assert_eq!(media_entries(&buf).unwrap(), ["a.png", "", "한.gif!"]);
        assert_eq!(media_entries(&[]).unwrap(), Vec::<String>::new());

        /* 길이가 버퍼를 넘으면 실패, 조용히 잘라 쓰지 않는다 */
        assert!(media_entries(&[0x0a, 50, 0x0a, 1, b'a']).is_none());
        /* 알 수 없는 wire type (3 = start group) */
        assert!(media_entries(&[0x0b]).is_none());

        let mut p = 0;
        assert_eq!(varint(&[0xac, 0x02], &mut p), Some(300));
        assert_eq!(p, 2);
        assert_eq!(varint(&[0x80], &mut 0), None, "끝나지 않은 varint");
    }

    #[test]
    fn pick_deck_prefers_user_deck() {
        assert_eq!(pick_deck(vec![(1, "Default".into())]).as_deref(), Some("Default"));
        assert_eq!(
            pick_deck(vec![(9, "B".into()), (1, "Default".into()), (5, "A\x1fSub".into())]).as_deref(),
            Some("A::Sub"),
            "id 순으로 첫 사용자 덱"
        );
        assert_eq!(pick_deck(vec![]), None);
    }
}
