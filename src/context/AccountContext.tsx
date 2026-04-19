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

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    if (user.role === 'super_admin') {
      setLoading(true)
      fetchAccounts()
        .then(accs => {
          setAccounts(accs)
          if (accs.length > 0 && !selectedId) setSelectedId(accs[0].id)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      setSelectedId(user.account_id)
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
