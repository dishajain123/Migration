import { Pause, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { ChatSource } from '@/types/ai';
import { toSpeechText } from '@/domain/plainText';
import { useVoiceStore } from '@/stores/voiceStore';
import { textToSpeech } from '@/services/voice/textToSpeech';
import { Button } from '../ui';

const RATES = [0.75, 1, 1.25, 1.5];

/** Speaker controls for one assistant message: play/pause, stop, replay and a speed cycle. Only one message speaks at a time. */
export function SpeakButton({ messageId, text, sources }: { messageId: string; text: string; sources?: ChatSource[] }) {
  const { speakingId, status, rate, setRate, speak, togglePause, stop, error } = useVoiceStore();
  if (!textToSpeech.isSupported() || !text.trim()) return null;
  const active = speakingId === messageId;

  const onToggle = () => {
    if (active) togglePause();
    else speak(messageId, toSpeechText(text, sources));
  };
  const onReplay = () => speak(messageId, toSpeechText(text, sources));
  const cycleRate = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted" onClick={onToggle}
        aria-label={active && status === 'playing' ? 'Pause speech' : 'Read response aloud'}
      >
        {active && status === 'playing' ? <Pause size={12} /> : <Volume2 size={12} />} {active && status === 'playing' ? 'Pause' : active ? 'Resume' : 'Listen'}
      </Button>
      {active && (
        <>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={stop} aria-label="Stop speech"><Square size={11} /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onReplay} aria-label="Replay from the start"><RotateCcw size={11} /></Button>
          <Button variant="ghost" size="sm" className="h-6 px-1 text-[10px] text-muted" onClick={cycleRate} aria-label="Change playback speed">{rate}x</Button>
        </>
      )}
      {active && error && <span className="text-[10px] text-bad">{error}</span>}
    </div>
  );
}
