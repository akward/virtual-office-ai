/** Apply full 19-agent roster at startup (works even if store still has old 5 agents) */
import { defaultAgents } from './agents'

type StoreApi = { setState: (p: any) => void; getState: () => any }

export function applyFullRoster(store: StoreApi) {
  store.setState({
    agents: defaultAgents.map((a) => ({ ...a, status: 'idle' as const, currentTask: '', lastMessage: a.lastMessage || 'Siap!' })),
  })
}
