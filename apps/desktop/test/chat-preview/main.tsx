import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeClientStorage } from '@/packages/client-storage';
import { SessionChatView } from '@/packages/core-ui/chat/session-chat-view';
import { ChatPreviewBackend } from '@/packages/shared/session-chat-preview/backend';
import {
  DEFAULT_CHAT_PREVIEW,
  PREVIEW_SCENARIOS,
  type ChatPreviewConfig,
} from '@/packages/shared/session-chat-preview/fixture';
import '@/packages/core-ui/styles.css';
import './preview.css';
const embedded = new URLSearchParams(location.search).has('embedded');

function Conversation({ config }: { config: ChatPreviewConfig }) {
  const [hostAction, setHostAction] = useState('');
  const transport = useMemo(() => new ChatPreviewBackend(config).transport(), []);
  return (
    <div className='comparison-conversation' style={{ zoom: config.zoom / 100 }}>
      {hostAction && (
        <output
          style={{
            position: 'absolute',
            zIndex: 20,
            background: config.theme === 'light' ? '#fff' : '#141414',
            fontSize: 12,
            top: 0,
            left: 0,
            right: 0,
          }}
          aria-live='polite'
        >
          {hostAction}
        </output>
      )}
      <SessionChatView
        transport={transport}
        // Menu rows that would leave the chat show the request they send, like the GPUI pane's label.
        hostLinks={{
          openFile: (path, position) => setHostAction(JSON.stringify({ action: 'openFile', path, ...position })),
          openFileInCode: (path, position) =>
            setHostAction(JSON.stringify({ action: 'openFile', path, view: 'code', ...position })),
          openFileInDocs: (path, position) =>
            setHostAction(JSON.stringify({ action: 'openFile', path, view: 'docs', ...position })),
          locateFile: (path) => setHostAction(JSON.stringify({ action: 'locateFile', path })),
          openUrl: (url, options) => setHostAction(JSON.stringify({ action: 'openLink', url, ...options })),
        }}
        sessionKey={`chat-preview:${config.revision}`}
        sessionTitle='Sample conversation'
        theme={config.theme}
        verboseMode={config.verbose}
        simpleMode={config.simple}
        canSend
        sendOnEnter
      />
    </div>
  );
}
function Preview() {
  const [config, setConfig] = useState(DEFAULT_CHAT_PREVIEW);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const read = async () => {
      try {
        const response = await fetch('/__preview/state');
        if (!response.ok) throw new Error(await response.text());
        const next = await response.json();
        if (!disposed) {
          setConfig((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
          setError('');
        }
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    };
    void read();
    const timer = setInterval(read, 500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const update = async (patch: Partial<ChatPreviewConfig>) => {
    const response = await fetch('/__preview/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, ...patch }),
    });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setConfig(await response.json());
  };
  return (
    <div className='comparison-app' data-theme={config.theme}>
      {!embedded && (
        <header className='comparison-controls'>
          <strong>Chat Lab · React</strong>
          <label>
            Sample{' '}
            <select
              value={config.scenario}
              onChange={(event) => void update({ scenario: event.target.value as ChatPreviewConfig['scenario'] })}
            >
              {PREVIEW_SCENARIOS.map((scenario) => (
                <option key={scenario}>{scenario}</option>
              ))}
            </select>
          </label>
          <label>
            Theme{' '}
            <select
              value={config.theme}
              onChange={(event) => void update({ theme: event.target.value as 'dark' | 'light' })}
            >
              <option>dark</option>
              <option>light</option>
            </select>
          </label>
          <label>
            Zoom{' '}
            <select value={config.zoom} onChange={(event) => void update({ zoom: Number(event.target.value) })}>
              {[70, 85, 100, 125, 150, 200].map((zoom) => (
                <option key={zoom} value={zoom}>
                  {zoom}%
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type='checkbox'
              checked={config.verbose}
              onChange={(event) => void update({ verbose: event.target.checked })}
            />{' '}
            Verbose
          </label>
          <label>
            <input
              type='checkbox'
              checked={config.simple}
              onChange={(event) => void update({ simple: event.target.checked })}
            />{' '}
            Simple
          </label>
          <button onClick={() => void update({})}>Reset both</button>
          <span className='comparison-help'>Controls update both panes. Sends are simulated independently.</span>
          {error && <span role='alert'>{error}</span>}
        </header>
      )}
      <Conversation key={JSON.stringify(config)} config={config} />
    </div>
  );
}
await initializeClientStorage();
createRoot(document.getElementById('root')!).render(<Preview />);
