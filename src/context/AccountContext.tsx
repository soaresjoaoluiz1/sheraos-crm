import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { fetchAccounts, type Account } from '../lib/api'

interface AccountCtx {
  accountId: number | null
  accounts: Account[]
  setAccountId: (id: number) => void
  loading: boolean
}

const AccountContext = createContext<AccountCtx>({} as AccountCtx)

const STORAGE_KEY = 'dros_crm_active_account'

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedId, setSelectedIdState] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const setSelectedId = (id: number) => {
    setSelectedIdState(id)
    try { localStorage.setItem(STORAGE_KEY, String(id)) } catch {}
  }

  useEffect(() => {
    if (!user) return
    if (user.role === 'super_admin') {
      setLoading(true)
      fetchAccounts()
        .then(accs => {
          setAccounts(accs)
          if (accs.length > 0 && !selectedId) {
            // Prioridade: 1) ultima conta usada (localStorage)  2) conta propria do admin  3) primeira da lista
            const stored = Number(localStorage.getItem(STORAGE_KEY))
            const fromStorage = stored && accs.find(a => a.id === stored) ? stored : null
            const own = user.account_id ? accs.find(a => a.id === user.account_id)?.id : null
            setSelectedIdState(fromStorage || own || accs[0].id)
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      setSelectedIdState(user.account_id)
    }
  }, [user])

  const accountId = user?.role === 'super_admin' ? selectedId : user?.account_id || null

  return (
    <AccountContext.Provider value={{ accountId, accounts, setAccountId: setSelectedId, loading }}>
      {children}
    </AccountContext.Provider>
  )
}

export const useAccount = () => useContext(AccountContext)
