import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import LauncherLayout from './components/layout/LauncherLayout'
import SetupGuard from './components/setup/SetupGuard'
import PlatformsScreen from './screens/PlatformsScreen'
import LibraryScreen from './screens/LibraryScreen'
import StoreDetailScreen from './screens/StoreDetailScreen'
import DownloadsScreen from './screens/DownloadsScreen'
import SettingsScreen from './screens/SettingsScreen'
import SetupWizardScreen from './screens/SetupWizardScreen'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<SetupGuard />}>
          <Route path="/setup" element={<SetupWizardScreen />} />
          <Route element={<LauncherLayout />}>
            <Route index element={<PlatformsScreen />} />
            <Route path="library" element={<LibraryScreen />} />
            <Route path="store/:storeId" element={<StoreDetailScreen />} />
            <Route path="downloads" element={<DownloadsScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="wine" element={<Navigate to="/settings?tab=wine" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  )
}
