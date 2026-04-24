import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAccounts, createAccount, formatNumber, type Account } from '../../lib/api'
import { Building2, Plus, Eye } from 'lucide-react'

const SEGMENTOS = ['Imobiliaria', 'Clinica', 'E-commerce', 'Restaurante', 'Educacao', 'Saude', 'Servicos', 'Industria', 'Varejo', 'Tecnologia', 'Outro']

export default function Clients() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', cnpj: '', razao_social: '', instagram: '', segmento: '', trabalha_anuncio: false, investimento_anuncios: '', valor_mensal: '', observacoes: '' })

  const load = () => { setLoading(true); fetchAccounts().then(setAccounts).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async () => {
    if (!form.name) return
    await createAccount({
      ...form,
      trabalha_anuncio: form.trabalha_anuncio ? 1 : 0,
      valor_mensal: form.valor_mensal ? parseFloat(form.valor_mensal) : undefined,
      investimento_anuncios: form.investimento_anuncios ? parseFloat(form.investimento_anuncios) : undefined,
    } as any)
    setShowNew(false)
    setForm({ name: '', cnpj: '', razao_social: '', instagram: '', segmento: '', trabalha_anuncio: false, investimento_anuncios: '', valor_mensal: '', observacoes: '' })
    load()
  }

  const u = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))

  return (
    <div>
      <div className="page-header">
        <h1><Building2 size={20} style={{ marginRight: 8 }} /> Clientes</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Cliente</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>CNPJ</th><th>Instagram</th><th className="right">Leads</th><th>Anuncio</th><th className="right">Valor</th><th>Status</th><th className="right">Acoes</th></tr></thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id}>
                <td className="name">{a.name}</td>
                <td style={{ color: '#9B96B0', fontSize: 12 }}>{a.cnpj || '-'}</td>
                <td style={{ fontSize: 12 }}>{a.instagram || '-'}</td>
                <td className="right" style={{ fontWeight: 600 }}>{formatNumber(a.lead_count || 0)}</td>
                <td><span style={{ color: a.trabalha_anuncio ? '#34C759' : '#9B96B0', fontSize: 12 }}>{a.trabalha_anuncio ? 'Sim' : 'Nao'}</span></td>
                <td className="right" style={{ fontSize: 12 }}>{a.valor_mensal ? `R$ ${a.valor_mensal.toLocaleString('pt-BR')}` : '-'}</td>
                <td><span style={{ color: a.is_active ? '#34C759' : '#FF6B6B' }}>{a.is_active ? 'Ativo' : 'Inativo'}</span></td>
                <td className="right"><button className="btn btn-secondary btn-sm" onClick={() => navigate(`/admin/clients/${a.id}`)}><Eye size={12} /> Ver</button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhum cliente cadastrado</td></tr>}
          </tbody>
        </table></div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <h2>Novo Cliente</h2>

            <div className="form-group"><label>Nome Fantasia *</label><input className="input" value={form.name} onChange={e => u('name', e.target.value)} placeholder="Ex: Dros Agencia" /></div>

            <div className="form-row">
              <div className="form-group"><label>CNPJ</label><input className="input" value={form.cnpj} onChange={e => u('cnpj', e.target.value)} placeholder="00.000.000/0000-00" /></div>
              <div className="form-group"><label>Nome da Empresa</label><input className="input" value={form.razao_social} onChange={e => u('razao_social', e.target.value)} placeholder="Razao social" /></div>
            </div>

            <div className="form-row">
              <div className="form-group"><label>Instagram</label><input className="input" value={form.instagram} onChange={e => u('instagram', e.target.value)} placeholder="@perfil" /></div>
              <div className="form-group"><label>Segmento</label>
                <select className="select" value={form.segmento} onChange={e => u('segmento', e.target.value)}>
                  <option value="">Selecionar...</option>
                  {SEGMENTOS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Trabalha com anuncio?</label>
                <select className="select" value={form.trabalha_anuncio ? 1 : 0} onChange={e => u('trabalha_anuncio', parseInt(e.target.value))}>
                  <option value={0}>Nao</option>
                  <option value={1}>Sim</option>
                </select>
              </div>
              <div className="form-group"><label>Investimento em Anuncios (R$)</label><input className="input" type="number" step="0.01" value={form.investimento_anuncios} onChange={e => u('investimento_anuncios', e.target.value)} placeholder="5000.00" /></div>
            </div>

            <div className="form-group"><label>Valor Mensal (R$)</label><input className="input" type="number" step="0.01" value={form.valor_mensal} onChange={e => u('valor_mensal', e.target.value)} placeholder="2500.00" /></div>

            <div className="form-group"><label>Observacoes</label><textarea className="input" rows={3} value={form.observacoes} onChange={e => u('observacoes', e.target.value)} placeholder="Anotacoes..." style={{ resize: 'vertical' }} /></div>

            <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 8 }}>Um funil padrao sera criado automaticamente.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name}>Criar Cliente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
