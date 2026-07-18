import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'reachable' | 'unavailable';

const statusLabels: Record<ApiStatus, string> = {
  checking: 'Checking API…',
  reachable: 'API reachable',
  unavailable: 'API unavailable',
};

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const apiBaseUrl =
      import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

    void fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then((response) => {
        setApiStatus(response.ok ? 'reachable' : 'unavailable');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setApiStatus('unavailable');
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="shell">
      <p className="eyebrow">Deterministic work, one day at a time</p>
      <h1>AI Execution Assistant</h1>
      <p className="intro">
        The application foundation is ready for capture, planning, focus, and
        review workflows.
      </p>
      <p className={`api-status api-status--${apiStatus}`} role="status">
        <span aria-hidden="true" className="status-dot" />
        {statusLabels[apiStatus]}
      </p>
    </main>
  );
}
