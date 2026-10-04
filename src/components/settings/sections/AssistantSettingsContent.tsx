'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AgentMemoryPanel } from '@/components/settings/AgentMemoryPanel'
import { AgentKnowledgePanel } from '@/components/agent-knowledge/AgentKnowledgePanel'
import { SettingsSectionHeader, SettingsSeg } from '@/components/settings/SettingsRows'

// "Assistenten": the ledger profile the agent reads before booking (Kunskap =
// "Vad din agent vet", opens on the konteringskarta and is the default view),
// what the assistant remembers about this company (Minne, editable), and the
// domain knowledge it ships with (Kompetens, read-only). The segmented control
// keeps all three one click away instead of stacked.
type View = 'knowledge' | 'memory' | 'skills'

const VIEW_ROUTE: Record<View, string> = {
  knowledge: '/settings/assistant',
  memory: '/settings/assistant?view=memory',
  skills: '/skills',
}

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'knowledge', label: 'Kunskap' },
  { value: 'memory', label: 'Minne' },
  { value: 'skills', label: 'Kompetens' },
]

/** `agentsEnabled`: the Kompetens view links to the Agenter page, hidden in production while it is finished. */
export function AssistantSettingsContent({ agentsEnabled = true }: { agentsEnabled?: boolean }) {
  const tNav = useTranslations('settings_nav')
  const tIntro = useTranslations('settings_intro')
  const searchParams = useSearchParams()
  const router = useRouter()
  const raw = searchParams.get('view')
  const view: View = raw === 'skills' && agentsEnabled ? 'skills' : raw === 'memory' ? 'memory' : 'knowledge'
  useEffect(() => { if (view === 'skills') router.replace('/skills') }, [view, router])

  function setView(next: View) {
    // 'knowledge' is the default: keep its URL clean (no query string).
    router.replace(VIEW_ROUTE[next] ?? VIEW_ROUTE.knowledge, { scroll: false })
  }

  return (
    <div>
      <SettingsSectionHeader title={tNav('assistant')} intro={tIntro('assistant')} />

      <div className="mt-6">
        <SettingsSeg value={view} onChange={setView} options={agentsEnabled ? VIEW_OPTIONS : VIEW_OPTIONS.filter((o) => o.value !== 'skills')} aria-label="Välj vy" />
      </div>

      {/* Only the active view mounts, so each panel's data is fetched lazily
          the first time its view is opened (same behavior as when Radix Tabs
          unmounted the inactive panels). */}
      <div className="mt-6">
        {view === 'knowledge' && <AgentKnowledgePanel />}
        {view === 'memory' && <AgentMemoryPanel />}
      </div>
    </div>
  )
}

// The floating assistant button (and its /chat nav entry) is hidden
// unconditionally on this self-hosted deployment (DashboardNav.tsx,
// app/(dashboard)/layout.tsx), so the per-user visibility toggle that used
// to live here would only offer a switch that can never take effect.
