import { useState, useEffect } from 'react'
import { fetchGlobalDashboard, formatNumber } from '../../lib/api'
import { Building2, Users, Calendar } from 'lucide-react'

export default function GlobalDashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchGlobalDashboard().then(setData).catch(() => {}).finally(() => setLoading(false)) }, [])

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!data) return <div className="empty-state"><h3>Sem dados</h3></div>

  return (
    <div>
      <div className="page-header"><h1>Dashboard Global</h1></div>

      <section className="dash-section">
        <div className="metrics-grid">
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Contas Ativas</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><Building2 size={16} /></div></div><div className="metric-value">{data.accounts.length}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Total Leads</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><Users size={16} /></div></div><div className="metric-value">{formatNumber(data.totalLeads)}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Leads Hoje</span><div className="metric-icon" style={{ background: '#5DADE220', color: '#5DADE2' }}><Calendar size={16} /></div></div><div className="metric-value">{formatNumber(data.leadsToday)}</div></div>
        </div>
      </section>

      <section className="dash-section">
        <div className="section-title">Contas</div>
        <div className="table-card"><table>
          <thead><tr><th>Cliente</th><th className="right">Total Leads</th><th className="right">Leads Hoje</th><th className="right">Atendentes</th></tr></thead>
          <tbody>
            {data.accounts.map((a: any) => (
              <tr key={a.id}><td className="name">{a.name}</td><td className="right" style={{ fontWeight: 600 }}>{formatNumber(a.total_leads)}</td><td className="right">{a.leads_today}</td><td className="right">{a.attendants}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  )
}
