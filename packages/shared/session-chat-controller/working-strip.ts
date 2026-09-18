import type { SessionChatTerminalActivity } from '../session-chat';
import type { ChatLifecycle } from './lifecycle';
import { pickSessionChatWorkingWord } from '../session-chat-presentation/working-words';

/** CDXC:SessionChat 2026-09-17 SEE-ALSO: React's working strip and the QuickJS native host share stint words and activity precedence here; visual dimensions and spark artwork live in session-chat-presentation/working-strip.json. */
export function computeSessionChatWorkingStrip(
  working: boolean,
  activity: SessionChatTerminalActivity | null,
  { useState, useEffect }: Pick<ChatLifecycle, 'useState' | 'useEffect'>
) {
  const [word, setWord] = useState(pickSessionChatWorkingWord);
  useEffect(() => {
    if (working) setWord(pickSessionChatWorkingWord());
  }, [working]);
  return { label: !activity && working ? `${word}…` : null, activity };
}
