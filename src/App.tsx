import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DataModelPage } from './features/dataModel/DataModelPage';
import { LineagePage } from './features/lineage/LineagePage';
import { MappingPage } from './features/mapping/MappingPage';
import { ProceduresPage } from './features/procedures/ProceduresPage';
import { RulesPage } from './features/rules/RulesPage';
import { useThemeStore } from './stores/themeStore';

export function App() {
  const init = useThemeStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="data-model" element={<DataModelPage />} />
        <Route path="lineage" element={<LineagePage />} />
        <Route path="procedures" element={<ProceduresPage />} />
        <Route path="mapping" element={<MappingPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="*" element={<div className="p-6 text-muted">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
