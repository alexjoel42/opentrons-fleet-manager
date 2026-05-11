import { Routes, Route } from 'react-router-dom'
import { NotificationProvider, NotificationToasts } from './lib/NotificationContext'
import { AppLayout } from './components/AppLayout'
import { Setup } from './pages/Setup'
import { Dashboard } from './pages/Dashboard'
import { RobotDetail } from './pages/RobotDetail'
import { RunDetail } from './pages/RunDetail'
import './App.css'

function App() {
  return (
    <NotificationProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Setup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          {/* More specific run detail first so /robot/ip/runs/runId doesn’t match only /robot/:ip */}
          <Route path="/robot/:ip/runs/:runId" element={<RunDetail />} />
          <Route path="/robot/:ip" element={<RobotDetail />} />
        </Route>
      </Routes>
      <NotificationToasts />
    </NotificationProvider>
  )
}

export default App
