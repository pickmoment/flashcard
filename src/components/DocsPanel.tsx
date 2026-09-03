/**
 * 스킬 문서를 앱 안에서 읽는다. 바이너리에 실린 `vendor/flashcards/` 사본을 보므로
 * 스킬을 설치하지 않아도 같은 문서가 나온다.
 *
 * 마크다운을 렌더하지 않고 원문을 그대로 둔다 — 이 문서는 사람이 읽는 산문이 아니라
 * 프롬프트·필드 계약이고, 쓰인 그대로 보는 것이 맞다.
 */
import { useMemo, useState } from "react";
import { DOCS } from "../engine/boot";

export function DocsPanel() {
  const [key, setKey] = useState(DOCS[0]?.key ?? "");
  const [query, setQuery] = useState("");

  const doc = DOCS.find((d) => d.key === key) ?? DOCS[0];

  /* 검색은 줄 단위로 남긴다 — 어느 줄인지 알아야 원문에서 찾아갈 수 있다. */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !doc) return null;
    const out: { n: number; line: string }[] = [];
    doc.body.split("\n").forEach((line, i) => {
      if (line.toLowerCase().includes(q)) out.push({ n: i + 1, line });
    });
    return out;
  }, [doc, query]);

  return (
    <div className="panel grow">
      <div className="tabs">
        {DOCS.map((d) => (
          <button
            type="button"
            key={d.key}
            className={d.key === doc?.key ? "tab active" : "tab"}
            onClick={() => setKey(d.key)}
          >
            {d.title}
            <span className="count">{d.body.split("\n").length}줄</span>
          </button>
        ))}
      </div>
      <div className="panel-body" style={{ paddingBottom: 0 }}>
        <input
          className="input"
          value={query}
          placeholder="문서 안에서 찾기 — 비우면 전문"
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits ? (
          <div className="field-hint">
            {hits.length ? `${hits.length}줄 일치` : "일치하는 줄이 없다"}
          </div>
        ) : null}
      </div>
      <div className="scroll grow">
        <div className="doc">
          {hits
            ? hits.map((h) => (
                <div key={h.n}>
                  <span className="mono muted">{String(h.n).padStart(4, " ")} </span>
                  {h.line}
                </div>
              ))
            : (doc?.body ?? "")}
        </div>
      </div>
    </div>
  );
}
