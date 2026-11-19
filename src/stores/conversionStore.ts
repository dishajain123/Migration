import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS } from '@/domain/ruleConversion/convert';
import type { ConversionSettings, RuleDecision, RuleEdit, RuleTemplate, SqlFileAnalysis, TraqRuleFields } from '@/types';

/*
 * Agent 5 rule-migration workspace state. Mappings are NOT stored here: they come from Agent 4 (reviewStore) and the
 * workbook. Persisted: reviewer edits/decisions, settings and template choice. Session only: the analysed files.
 */
interface ConversionState {
  files: SqlFileAnalysis[];
  settings: ConversionSettings;
  templateId: RuleTemplate['id'];
  edits: Record<string, RuleEdit>;
  addFiles: (list: SqlFileAnalysis[]) => void;
  removeFile: (fileName: string) => void;
  clearFiles: () => void;
  setSettings: (patch: Partial<ConversionSettings>) => void;
  setTemplate: (id: RuleTemplate['id']) => void;
  editRule: (id: string, patch: Partial<TraqRuleFields>) => void;
  decide: (ids: string[], decision: RuleDecision | null, comment?: string) => void;
  resetRule: (id: string) => void;
  resetAllEdits: () => void;
}

const now = () => new Date().toISOString();

export const useConversionStore = create<ConversionState>()(
  persist(
    (set, get) => ({
      files: [],
      settings: DEFAULT_SETTINGS,
      templateId: 'dd-export',
      edits: {},
      addFiles(list) {
        const names = new Set(list.map((f) => f.fileName));
        set({ files: [...get().files.filter((f) => !names.has(f.fileName)), ...list] });
      },
      removeFile(fileName) { set({ files: get().files.filter((f) => f.fileName !== fileName) }); },
      clearFiles() { set({ files: [] }); },
      setSettings(patch) { set({ settings: { ...get().settings, ...patch } }); },
      setTemplate(id) { set({ templateId: id }); },
      editRule(id, patch) {
        const cur = get().edits[id];
        set({ edits: { ...get().edits, [id]: { ...cur, traq: { ...(cur?.traq ?? {}), ...patch }, editedAt: now() } } });
      },
      decide(ids, decision, comment) {
        const next = { ...get().edits };
        for (const id of ids) {
          const cur = next[id];
          next[id] = { ...cur, decision: decision ?? undefined, comment: comment ?? cur?.comment, editedAt: now() };
        }
        set({ edits: next });
      },
      resetRule(id) {
        const next = { ...get().edits };
        delete next[id];
        set({ edits: next });
      },
      resetAllEdits() { set({ edits: {} }); },
    }),
    {
      name: 'crismac-traq-rule-conversion-v1',
      partialize: (s) => ({ settings: s.settings, templateId: s.templateId, edits: s.edits }),
    },
  ),
);
