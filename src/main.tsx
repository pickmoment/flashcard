import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole, info } from "@tauri-apps/plugin-log";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { bootError } from "./engine/boot";
import { HAS_TAURI } from "./lib/tauri";
import "./styles.css";

/* 번들에서는 개발자 도구를 열 수 없다. `attachConsole` 은 Rust 로그를 웹뷰 콘솔로 끌어오고,
   `info`/`error` 는 반대로 웹뷰에서 앱 로그 파일로 밀어 넣는다 — 부팅 여부와 실패를
   나중에 확인할 수 있는 유일한 길이다 (macOS: ~/Library/Logs/com.flashcard.app/flashcard.log). */
if (HAS_TAURI) {
  void attachConsole().then(() => info(`부팅 — 엔진 ${bootError ? "실패" : "정상"}`));
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (bootError) {
  root.render(
    <div className="crash">
      <h1>엔진을 불러오지 못했다</h1>
      <p className="mono">{bootError.message}</p>
      <p className="hint">
        앱을 다시 설치하거나, `vendor/flashcards/assets/deckcards.js` 가 온전한지 확인한다.
      </p>
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
