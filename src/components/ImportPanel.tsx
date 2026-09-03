/**
 * 표·목록 가져오기.
 *
 * 이미 있는 단어장을 다시 타이핑하지 않게 하는 것이 이 패널의 전부다. 붙여넣은
 * 원문을 엔진의 `parseImport` 에 그대로 넘기고, 읽어낸 결과를 먼저 보여준 다음
 * 사용자가 확인하고 나서 덱에 넣는다 — 파싱은 추측이 섞이므로 미리보기가 없으면
 * 덱을 망친 뒤에야 알게 된다.
 */
import { useMemo, useState } from "react";
import { FCD } from "../engine/boot";
import { HAS_TAURI, api, dialogs, pickTextFile } from "../lib/tauri";
import type { Card, ImportResult } from "../engine/types";

type Format = "auto" | "csv" | "tsv" | "md" | "anki";

const FORMATS: { value: Format; label: string }[] = [
  { value: "auto", label: "자동 — 원문을 보고 고른다" },
  { value: "csv", label: "csv — 쉼표로 나뉜 표" },
  { value: "tsv", label: "tsv — 탭으로 나뉜 표(스프레드시트 복사)" },
  { value: "md", label: "md — 목록 한 줄에 한 장" },
  { value: "anki", label: "anki — 내보낸 탭 구분 텍스트" },
];

export function ImportPanel(props: {
  onImport(cards: Card[], mode: "append" | "replace"): void;
  onToast(msg: string, kind?: "ok" | "err"): void;
}) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<Format>("auto");
  const [busy, setBusy] = useState(false);

  /* 엔진 파싱은 입력이 아무 모양이나 될 수 있다 — 던져도 패널이 죽지 않게 감싼다. */
  const parsed = useMemo<{ result: ImportResult | null; crash: string }>(() => {
    if (!text.trim()) return { result: null, crash: "" };
    try {
      return { result: FCD.parseImport(text, { format, startId: 1 }), crash: "" };
    } catch (e) {
      return { result: null, crash: String(e) };
    }
  }, [text, format]);

  /* 자동일 때 실제로 어떤 형식으로 읽었는지 알려 준다 — 틀렸으면 직접 고르면 된다. */
  const detected = useMemo(() => {
    if (format !== "auto" || !text.trim()) return "";
    try {
      return FCD.detectFormat(text);
    } catch {
      return "";
    }
  }, [format, text]);

  const cards = parsed.result ? parsed.result.cards : [];
  /* `cards` 는 파싱 결과에서 매번 새로 나오는 배열이라 그 자체를 의존성으로 쓸 수 없다 —
     의존성은 파싱 결과 하나로 두고 개수 세기만 여기서 한다. */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of parsed.result?.cards ?? []) counts[c.type] = (counts[c.type] ?? 0) + 1;
    return Object.entries(counts);
  }, [parsed.result]);

  const load = async () => {
    setBusy(true);
    try {
      if (HAS_TAURI) {
        const path = await dialogs.openTable();
        if (path) {
          setText(await api.readText(path));
          props.onToast("파일을 읽었다");
        }
      } else {
        const picked = await pickTextFile(".csv,.tsv,.txt,.md");
        if (picked) {
          setText(picked.text);
          props.onToast(`${picked.name} 을 읽었다`);
        }
      }
    } catch (e) {
      props.onToast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body">
      <div className="field">
        <label className="field-label">
          원문
          {detected ? <span className="badge">{detected} 로 읽는다</span> : null}
        </label>
        <textarea
          className="textarea"
          style={{ minHeight: 140 }}
          value={text}
          placeholder={"앞면,뒷면,카테고리\n미토콘드리아,세포의 에너지 공장,생물"}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row tight">
          <button type="button" className="btn sm" disabled={busy} onClick={() => void load()}>
            파일에서 읽기
          </button>
          <button
            type="button"
            className="btn sm ghost"
            disabled={!text}
            onClick={() => setText("")}
          >
            비우기
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">형식</label>
        <select
          className="select"
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="field-hint">
          csv · tsv 는 <span className="mono">앞면,뒷면[,카테고리,보충]</span> — 머리글(앞면/뒷면 ·
          front/back)이 있으면 알아서 읽는다. md 는{" "}
          <span className="mono">앞면 :: 뒷면</span> 또는 <span className="mono">앞면 | 뒷면</span>.
          답 칸 없이 <span className="mono">{"{{ }}"}</span> 만 있으면 빈칸 카드, 답이{" "}
          <span className="mono">-&gt;</span> · <span className="mono">→</span> 로 이어지면 순서
          카드로 읽는다.
        </div>
      </div>

      {parsed.crash ? (
        <div className="diag err">
          <span className="diag-mark">✕</span>
          <span>{parsed.crash}</span>
        </div>
      ) : null}

      {parsed.result ? (
        <>
          <div className="row tight">
            <span className={cards.length ? "badge ok" : "badge err"}>
              카드 {cards.length}장
            </span>
            {typeCounts.map(([t, n]) => (
              <span key={t} className="badge mute">
                {FCD.CARD_TYPES[t as Card["type"]]?.label ?? t} {n}
              </span>
            ))}
          </div>

          {parsed.result.warnings.map((w, i) => (
            <div className="diag warn" key={i}>
              <span className="diag-mark">!</span>
              <span>{w}</span>
            </div>
          ))}

          {cards.length ? (
            <div className="field">
              <label className="field-label">앞 5장</label>
              <div className="list">
                {cards.slice(0, 5).map((c, i) => (
                  <div className="card-row" key={c.id}>
                    <div className="card-row-n">{i + 1}</div>
                    <div className="card-row-main">
                      <div className="card-row-label">
                        {FCD.plain(c.text || c.front || c.back || "") || "(빈 카드)"}
                      </div>
                      <div className="card-row-meta">
                        <span>{FCD.CARD_TYPES[c.type]?.label ?? c.type}</span>
                        {c.category ? <span>· {c.category}</span> : null}
                        {c.items ? <span>· {c.items.length}단계</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {cards.length > 5 ? (
                <div className="field-hint">…외 {cards.length - 5}장</div>
              ) : null}
            </div>
          ) : null}

          <div className="row tight">
            <button
              type="button"
              className="btn primary"
              disabled={!cards.length}
              onClick={() => props.onImport(cards, "append")}
            >
              이어붙이기
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!cards.length}
              onClick={() => props.onImport(cards, "replace")}
            >
              덱 교체
            </button>
          </div>
          <div className="field-hint">
            여기서는 id 를 1부터 매겨 읽는다 — 이어붙이면 덱에 넣은 뒤 전체 번호를 다시 매긴다.
          </div>
        </>
      ) : (
        <div className="list-empty">원문을 붙여넣으면 읽어낸 카드를 먼저 보여준다.</div>
      )}
    </div>
  );
}
