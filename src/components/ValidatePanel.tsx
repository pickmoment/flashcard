/**
 * 검증 패널. 엔진의 `validate()` 결과를 CLI(`fc validate`) 와 같은 기준으로 보여준다.
 *
 * 경고는 접거나 숨기지 않는다 — 학습 설계(카테고리·퀴즈 출제·중복 개념)에 대한 지적이라
 * 보이는 것 자체가 목적이다. 무시하려면 이유가 있어야 한다.
 */
import type { ValidateResult } from "../engine/types";

/** `카드 3(id 12): front 가 없다` 처럼 카드를 짚는 메시지에서 번호를 뽑는다.
 *  숫자 뒤에 괄호(id) 나 구분자가 와야 한다 — `카드 20장이 카테고리 한 종류다` 같은
 *  덱 전체 경고의 "20" 을 카드 번호로 잘못 읽지 않게 한다. */
const AT_CARD = /^카드 (\d+)(?:\([^)]*\))?[ :]/;

function Diag({
  kind,
  mark,
  msg,
  onSelect,
}: {
  kind: "err" | "warn";
  mark: string;
  msg: string;
  onSelect: (n: number) => void;
}) {
  const at = AT_CARD.exec(msg);
  if (!at) {
    return (
      <div className={`diag ${kind}`}>
        <span className="diag-mark">{mark}</span>
        <span>{msg}</span>
      </div>
    );
  }

  /* 카드를 짚는 지적은 그 카드로 바로 갈 수 있어야 한다. `.diag` 에는 클릭 표시가
     없으므로 커서만 인라인으로 얹는다(전용 클래스를 새로 만들지 않는다). */
  const n = Number(at[1]);
  return (
    <div
      className={`diag ${kind}`}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      title={`카드 ${n} 로 이동`}
      onClick={() => onSelect(n)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect(n);
      }}
    >
      <span className="diag-mark">{mark}</span>
      <span>{msg}</span>
    </div>
  );
}

export function ValidatePanel({
  result,
  onSelect,
}: {
  result: ValidateResult;
  onSelect: (n: number) => void;
}) {
  const { errors, warnings } = result;

  return (
    <div className="col">
      <div className="row tight">
        {errors.length > 0 && <span className="badge err">오류 {errors.length}</span>}
        {warnings.length > 0 && <span className="badge warn">경고 {warnings.length}</span>}
        {errors.length === 0 && warnings.length === 0 && <span className="badge ok">통과</span>}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="list">
          {errors.map((msg, i) => (
            <Diag key={`e${i}`} kind="err" mark="✗" msg={msg} onSelect={onSelect} />
          ))}
          {warnings.map((msg, i) => (
            <Diag key={`w${i}`} kind="warn" mark="!" msg={msg} onSelect={onSelect} />
          ))}
        </div>
      )}

      <div className="field-hint">
        {errors.length === 0
          ? "빌드할 수 있다. 경고는 그대로 내보낼 수 있지만, 학습이 안 되는 이유가 대개 여기 있다."
          : "오류를 고치기 전에는 내보내지 않는다 — 카드를 짚는 줄은 눌러서 그 카드로 간다."}
      </div>
    </div>
  );
}
