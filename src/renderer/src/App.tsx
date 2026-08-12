import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '@renderer/state/queryClient'
import { Layout } from '@renderer/components/Layout'
import { Dashboard } from '@renderer/routes/Dashboard/Dashboard'
import { SandboxDetail } from '@renderer/routes/SandboxDetail/SandboxDetail'
import { GlobalPolicy } from '@renderer/routes/GlobalPolicy'
import { Mcp } from '@renderer/routes/Mcp'
import { Placeholder } from '@renderer/routes/Placeholder'

function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="sandboxes/:name" element={<SandboxDetail />} />
            <Route path="kits" element={<Placeholder title="Kits" />} />
            <Route path="secrets" element={<Placeholder title="Secrets" />} />
            <Route path="mcp" element={<Mcp />} />
            <Route path="policy" element={<GlobalPolicy />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}

export default App
