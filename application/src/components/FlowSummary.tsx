import { useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isDesktopRuntime } from "../storage/repository";
import { flowSummaryInput } from "../flowSummary";

type Prepared = { workspaceRoot: string; input: ReturnType<typeof flowSummaryInput> };
const keyError = (error: unknown) => String(error).includes("OPENROUTER_KEY_");

export function FlowSummary({ prepare }: { prepare: () => Promise<Prepared> }) {
  const running = useRef(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<{ path: string; markdown: string }>();

  const runSummary = async () => {
    setStatus("편집 내용과 파일 저장을 확인하는 중…");
    const prepared = await prepare();
    setStatus("OpenRouter로 Flow를 요약하는 중…");
    setResult(await invoke("summarize_flow", prepared));
    setStatus("요약 파일을 저장했습니다.");
  };
  const summarize = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setResult(undefined);
    try {
      if (!await invoke<boolean>("has_openrouter_api_key")) { setNeedsKey(true); setStatus(""); return; }
      await runSummary();
    } catch (error) {
      if (keyError(error)) setNeedsKey(true);
      setError(String(error).replace(/^OPENROUTER_KEY_(?:REQUIRED|INVALID):/, "")); setStatus("");
    } finally { running.current = false; setBusy(false); }
  };
  const registerKey = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setStatus("OpenRouter API 키를 확인하는 중…");
    try {
      await invoke("save_openrouter_api_key", { apiKey });
      setApiKey(""); setNeedsKey(false);
      await runSummary();
    } catch (error) {
      setError(String(error).replace(/^OPENROUTER_KEY_INVALID:/, "")); setStatus("");
    } finally { setBusy(false); }
  };
  const deleteKey = async () => {
    if (!window.confirm("저장된 OpenRouter API 키를 삭제할까요?")) return;
    setBusy(true); setError("");
    try {
      await invoke("delete_openrouter_api_key");
      setApiKey(""); setNeedsKey(true); setResult(undefined); setStatus("API 키를 삭제했습니다.");
    } catch (error) {
      setError(String(error)); setStatus("");
    } finally { setBusy(false); }
  };
  return <section className="flow-summary" aria-label="Flow 요약">
    <button className="button" disabled={busy || !isDesktopRuntime()} onClick={() => void summarize()}>이 Flow 요약</button>
    <button className="button" disabled={busy || !isDesktopRuntime()} onClick={() => void deleteKey()}>API 키 삭제</button>
    {status && <span role="status" className="flow-summary-status">{status}</span>}
    {needsKey && <form className="flow-summary-key" onSubmit={event => void registerKey(event)}>
      <button type="button" className="flow-summary-key-close" aria-label="API 키 등록 닫기" onClick={() => { setNeedsKey(false); setApiKey(""); setError(""); }}>×</button>
      <label htmlFor="openrouter-api-key">OpenRouter API 키</label>
      <input id="openrouter-api-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required autoFocus />
      <button className="button button-primary" disabled={busy}>등록하고 요약</button>
      <small><a href="https://openrouter.ai/keys" onClick={event => { event.preventDefault(); void openUrl(event.currentTarget.href); }}>OpenRouter에서 API 키 받기</a> · 키는 Windows 자격 증명 관리자에 저장됩니다.</small>
      {error && <span className="flow-summary-key-error" role="alert">등록 실패: {error}</span>}
    </form>}
    {error && !needsKey && <p className="flow-summary-error" role="alert">요약 실패: {error}</p>}
    {result && <details className="flow-summary-result">
      <summary>요약 Markdown 보기</summary>
      <p>{result.path}</p>
      <pre>{result.markdown}</pre>
    </details>}
  </section>;
}
