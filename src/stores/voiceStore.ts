import { create } from 'zustand';
import { textToSpeech } from '@/services/voice/textToSpeech';

interface VoiceState {
  /** Voice Conversation Mode: auto-reads the assistant's reply aloud once it finishes streaming. */
  voiceMode: boolean;
  setVoiceMode: (v: boolean) => void;
  /** The message currently speaking/paused, if any. Starting another stops this one first (no overlapping audio). */
  speakingId: string | null;
  status: 'idle' | 'playing' | 'paused';
  rate: number;
  voiceURI: string | null;
  error: string | null;
  setRate: (r: number) => void;
  setVoiceURI: (v: string | null) => void;
  speak: (id: string, text: string) => void;
  togglePause: () => void;
  stop: () => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  voiceMode: false,
  setVoiceMode: (v) => { if (!v) { get().stop(); } set({ voiceMode: v }); },
  speakingId: null,
  status: 'idle',
  rate: 1,
  voiceURI: null,
  error: null,
  setRate: (r) => set({ rate: r }),
  setVoiceURI: (v) => set({ voiceURI: v }),
  speak(id, text) {
    const { rate, voiceURI } = get();
    textToSpeech.speak(text, {
      rate,
      voiceURI,
      onStart: () => set({ speakingId: id, status: 'playing', error: null }),
      onEnd: () => set((s) => (s.speakingId === id ? { speakingId: null, status: 'idle' } : s)),
      onError: (message) => set({ speakingId: null, status: 'idle', error: message }),
    });
  },
  togglePause() {
    const { status } = get();
    if (status === 'playing') { textToSpeech.pause(); set({ status: 'paused' }); }
    else if (status === 'paused') { textToSpeech.resume(); set({ status: 'playing' }); }
  },
  stop() { textToSpeech.stop(); set({ speakingId: null, status: 'idle' }); },
}));
