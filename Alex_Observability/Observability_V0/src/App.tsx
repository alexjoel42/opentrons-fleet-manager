import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/authContext'
import { NotificationProvider, NotificationToasts } from './lib/NotificationContext'
import { AppLayout } from './components/AppLayout'
import { Setup } from './pages/Setup'
import { Dashboard } from './pages/Dashboard'
import { RobotDetail } from './pages/RobotDetail'
import { RunDetail } from './pages/RunDetail'
import { Login } from './pages/Login'
import { CloudDashboard } from './pages/CloudDashboard'
import { CloudRobotDetail } from './pages/CloudRobotDetail'
import './App.css'

function CloudGuard({ children }: { children: React.ReactNode }) {
  const { isCloudMode, token } = useAuth()
  if (!isCloudMode) return <>{children}</>
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Setup />} />
          <Route
            path="/dashboard"
            element={
              <CloudGuard>
                <DashboardOrCloud />
              </CloudGuard>
            }
          />
          {/* More specific run detail first so /robot/ip/runs/runId doesn’t match only /robot/:ip */}
          <Route path="/robot/:ip/runs/:runId" element={<RunDetail />} />
          <Route path="/robot/:ip" element={<RobotDetail />} />
          <Route path="/robot/cloud/:id" element={<CloudGuard><CloudRobotDetail /></CloudGuard>} />
        </Route>
      </Routes>
      <NotificationToasts />
      </NotificationProvider>
    </AuthProvider>
  )
}

function DashboardOrCloud() {
  const { isCloudMode } = useAuth()
  if (isCloudMode) return <CloudDashboard />
  return <Dashboard />
}

export default App
