/**
 * 자동 복구 스냅샷 — 저장하지 않은 편집을 앱이 죽어도 잃지 않게.
 *
 * 저장 파일이 아니다. 사용자의 덱 파일은 "저장" 을 눌렀을 때만 쓰고, 스냅샷은 앱 데이터
 * 디렉토리(`<appDataDir>/autosave.json`, 브라우저는 localStorage `flashcard.autosave`)에
 * `{ path, at, deck }` 한 벌만 둔다. dirty 가 아니게 되는 순간(저장·다른 문서로 갈아탐·
 * undo 로 저장 시점 복귀) 지우므로, 부팅 때 이 파일이 있다는 것은 곧 "마지막 세션이 저장하지
 * 않은 채 끝났다" 는 뜻이다.
 */
import { useEffect, useRef } from "react";
import type { Deck } from "../engine/types";
import { HAS_TAURI, api, appDataPath } from "./tauri";

export interface Snapshot {
  /** 편집 중이던 파일. 새 덱이면 null */
  path: string | null;
  /** ISO 시각 */
  at: string;
  deck: Deck;
}

const FILE = "autosave.json";
const KEY = "flashcard.autosave";
/** 타이핑이 멎은 뒤 이만큼 지나면 쓴다. */
const DEBOUNCE_MS = 2000;

/* 쓰기와 지우기가 서로 앞지르지 않게 한 줄로 세운다 — 디바운스된 쓰기가 날아가는 중에 저장이
   끝나 지우면, 지운 뒤에 쓰기가 도착해 유령 스냅샷이 남는다 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

function parse(text: string | null): Snapshot | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<Snapshot>;
    if (!v || typeof v !== "object" || !v.deck || !Array.isArray(v.deck.cards)) return null;
    return { path: typeof v.path === "string" ? v.path : null, at: String(v.at ?? ""), deck: v.deck };
  } catch {
    return null;
  }
}

export const autosave = {
  /** 부팅 때 한 번. 없거나 읽을 수 없으면 null — 깨진 스냅샷으로 복구를 제안하지 않는다. */
  read(): Promise<Snapshot | null> {
    if (!HAS_TAURI) return Promise.resolve(parse(localStorage.getItem(KEY)));
    return serial(async () => {
      const file = await appDataPath(FILE);
      if (!(await api.fileExists(file))) return null;
      return parse(await api.readText(file));
    });
  },

  write(snap: Snapshot): Promise<void> {
    const body = JSON.stringify(snap);
    if (!HAS_TAURI) {
      localStorage.setItem(KEY, body);
      return Promise.resolve();
    }
    return serial(async () => {
      await api.writeText(await appDataPath(FILE), body);
    });
  },

  /** 브라우저에서는 동기로 끝난다 — pagehide 안에서 불러도 실제로 지워진다. */
  clear(): Promise<void> {
    if (!HAS_TAURI) {
      localStorage.removeItem(KEY);
      return Promise.resolve();
    }
    return serial(async () => api.removeFile(await appDataPath(FILE)));
  },
};

/**
 * dirty 인 채 덱이 바뀌면 디바운스해 스냅샷을 쓰고, dirty 가 풀리면 지운다.
 * 실패는 한 번만 알린다 — 2초마다 같은 토스트가 뜨면 편집을 방해한다.
 */
export function useAutosave(deck: Deck, path: string | null, dirty: boolean, onError: (msg: string) => void) {
  const wasDirty = useRef(dirty);
  const failed = useRef(false);

  useEffect(() => {
    const was = wasDirty.current;
    wasDirty.current = dirty;
    if (!dirty) {
      /* 마운트 직후(was === dirty === false) 에는 지우지 않는다 — 부팅 복구가 그 파일을 읽어야 한다 */
      if (was) void autosave.clear().catch(() => undefined);
      return;
    }
    const t = setTimeout(() => {
      autosave.write({ path, at: new Date().toISOString(), deck }).catch((e: unknown) => {
        if (failed.current) return;
        failed.current = true;
        onError(`자동 복구 파일을 쓰지 못했다 — ${(e as Error).message}`);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [deck, path, dirty, onError]);
}
