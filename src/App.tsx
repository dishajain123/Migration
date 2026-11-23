import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RedirectIfAuthed, RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { AiSettingsPage } from './features/aiSettings/AiSettingsPage';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
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
      <Route element={<RedirectIfAuthed />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="data-model" element={<DataModelPage />} />
          <Route path="lineage" element={<LineagePage />} />
          <Route path="procedures" element={<ProceduresPage />} />
          <Route path="mapping" element={<MappingPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="ai-settings" element={<AiSettingsPage />} />
          <Route path="*" element={<div className="p-6 text-muted">Page not found.</div>} />
        </Route>
      </Route>
    </Routes>
  );
}
