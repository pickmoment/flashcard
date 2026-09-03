/**
 * 산출물 기계 검수 — 엔진의 `check(html)`, 즉 `fc check` 와 같은 눈으로 본다.
 * 산출물 문자열을 직접 읽어 정책(단일 파일 · 한국어 문서 · 진행 저장 · 접근성)만 본다.
 */
import type { CheckResult } from "../engine/types";

export function CheckPanel({ result }: { result: CheckResult }) {
  return (
    <div className="col">
      <div className="field-hint">
        내보낼 파일이 정책을 지켰는지만 본다 — 화면이 잘 나오는지, 글자가 넘치는지는 보지 않는다.
        그것은 미리보기에서 카드를 넘겨 보며 확인한다.
      </div>

      <div className="list">
        {result.lines.map((line, i) => (
          <div key={i} className={`diag ${line.ok ? "ok" : "err"}`}>
            <span className="diag-mark">{line.ok ? "OK" : "MISS"}</span>
            <span>
              {line.label}
              {!line.ok && line.why && <div className="diag-why">← {line.why}</div>}
            </span>
          </div>
        ))}
      </div>

      <div className="muted mono">{result.info}</div>
    </div>
  );
}
