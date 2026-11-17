import type { FlowKind } from '@/types';

export const LAYER_COLOR: Record<string, string> = {
  CRISMAC: '#64748b', RECEPTION: '#0ea5e9', STAGING: '#d97706', MART: '#4f46e5', APP: '#16a34a', DI: '#db2777',
};

export const LAYER_LABEL: Record<string, string> = {
  CRISMAC: 'CrisMac source', RECEPTION: 'Reception', STAGING: 'Staging', MART: 'Data mart', APP: 'Application', DI: 'Data integration',
};

// Hex (not CSS variables) because SVG arrow markers cannot resolve var().
export const EDGE_COLOR = {
  direct: '#64748b', transformed: '#6366f1', unspecified: '#94a3b8',
  upstream: '#0ea5e9', downstream: '#16a34a', selected: '#f59e0b',
} as const;

export const KIND_LABEL: Record<FlowKind, string> = {
  direct: 'Direct copy', transformed: 'Transformed', unspecified: 'Type not stated',
};

export const KIND_HINT: Record<FlowKind, string> = {
  direct: 'MAP TYPE is DIRECT or RENAME: the value is copied across, only the column name may change.',
  transformed: 'Any other MAP TYPE (DERIVED, LOOKUP, JOIN, CONSTANT, ...): the value is computed, looked up or fixed rather than copied.',
  unspecified: 'The workbook row has a blank MAP TYPE, so it cannot be classed as direct or transformed.',
};

/** Rows shown per table before "show all". */
export const ROW_CAP = 10;
