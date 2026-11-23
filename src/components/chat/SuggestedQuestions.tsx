import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { AsyncView } from '../ui';

/** First-time-user prompts. Built by the service from real workbook object names, so each one returns a grounded answer. */
export function SuggestedQuestions({ route, onAsk, disabled }: { route: string; onAsk: (q: string) => void; disabled: boolean }) {
  const state = useAsync(() => services.assistant.getSuggestedQuestions(route), [route]);
  return (
    <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No suggestions available.">
      {(qs) => (
        <ul className="flex flex-col gap-1.5">
          {qs.map((q) => (
            <li key={q}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAsk(q)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-primarybg hover:text-primary disabled:opacity-50"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </AsyncView>
  );
}
