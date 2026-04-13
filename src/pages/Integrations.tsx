import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchWhatsAppInstances, createWhatsAppInstance, connectWhatsAppInstance,
  checkWhatsAppStatus, refreshWhatsAppQR, disconnectWhatsApp, deleteWhatsAppInstance,
  fetchEvolutionConfig, saveEvolutionConfig,
  type WhatsAppInstance,
} from '../lib/api'
import { Plug, Plus, Wifi, WifiOff, Loader, Trash2, QrCode, Power, PowerOff, RefreshCw, Smartphone, Save, Check, Settings } from 'lucide-react'

export default function Integrations() {
  const { accountId } = useAccount()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [activeQR, setActiveQR] = useState<number | null>(null)
  const pollRef = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  // Evolution config
  const [evoUrl, setEvoUrl] = useState('')
  const [evoKey, setEvoKey] = useState('')
  const [evoSaved, setEvoSaved] = useState(false)
  const [evoConfigured, setEvoConfigured] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const load = useCallback(() => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchWhatsAppInstances(accountId),
      fetchEvolutionConfig(accountId),
    ]).then(([insts, config]) => {
      setInstances(insts)
      setEvoUrl(config.api_url || '')
      setEvoKey(config.api_key || '')
      setEvoConfigured(!!(config.api_url && config.api_key))
    }).finally(() => setLoading(false))
  }, [accountId])

  useEffect(() => { load() }, [load])

  // Auto-poll status for connecting instances
  useEffect(() => {
    Object.values(pollRef.current).forEach(clearInterval)
    pollRef.current = {}

    instances.forEach(inst => {
      if (inst.status === 'connecting' && accountId) {
        pollRef.current[inst.id] = setInterval(async () => {
          try {
            const { instance: updated } = await checkWhatsAppStatus(inst.id, accountId)
            setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
            if (updated.status === 'connected') {
              clearInterval(pollRef.current[updated.id])
              delete pollRef.current[updated.id]
              setActiveQR(null)
            }
          } catch {}
        }, 5000)
      }
    })

    return () => { Object.values(pollRef.current).forEach(clearInterval); pollRef.current = {} }
  }, [instances.map(i => `${i.id}:${i.status}`).join(','), accountId])

  const handleSaveConfig = async () => {
    if (!accountId || !evoUrl || !evoKey) return
    setSavingConfig(true)
    try {
      await saveEvolutionConfig(accountId, { api_url: evoUrl, api_key: evoKey })
      setEvoConfigured(true)
      setEvoSaved(true)
      setTimeout(() => setEvoSaved(false), 2000)
    } catch (e: any) { alert('Erro: ' + e.message) }
    setSavingConfig(false)
  }

  const handleCreate = async () => {
    if (!accountId || !newName.trim()) return
    setCreating(true)
    try {
      const inst = await createWhatsAppInstance(accountId, { instance_name: newName.trim() })
      setShowNew(false)
      setNewName('')
      if (inst.qr_code) setActiveQR(inst.id)
      load()
    } catch (e: any) { alert('Erro: ' + e.message) }
    setCreating(false)
  }

  const handleConnect = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    try {
      const updated = await connectWhatsAppInstance(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
      if (updated.qr_code) setActiveQR(updated.id)
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleRefreshQR = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    try {
      const updated = await refreshWhatsAppQR(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleDisconnect = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    await disconnectWhatsApp(inst.id, accountId)
    setActiveQR(null)
    load()
  }

  const handleDelete = async (inst: WhatsAppInstance) => {
    if (!accountId || !confirm(`Deletar "${inst.instance_name}"?`)) return
    await deleteWhatsAppInstance(inst.id, accountId)
    setActiveQR(null)
    load()
  }

  const getStatusIcon = (status: string) => {
    if (status === 'connected') return <Wifi size={14} />
    if (status === 'connecting') return <Loader size={14} className="spinning" />
    return <WifiOff size={14} />
  }
  const getStatusColor = (status: string) => status === 'connected' ? '#34C759' : status === 'connecting' ? '#FBBC04' : '#FF6B6B'
  const getStatusLabel = (status: string) => status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Aguardando QR...' : 'Desconectado'

  const qrInstance = instances.find(i => i.id === activeQR)

  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <h1><Plug size={20} style={{ marginRight: 8 }} />Integracoes</h1>
        {evoConfigured && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Conectar WhatsApp</button>
        )}
      </div>

      {/* Evolution API Config */}
      <section className="dash-section">
        <div className="section-title"><Settings size={14} /> Configuracao Evolution API</div>
        <div className="card">
          <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>Configure uma vez a URL e API Key do seu servidor Evolution API. Todos os numeros WhatsApp desta conta usarao estas credenciais.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>URL da API</label>
              <input className="input" value={evoUrl} onChange={e => setEvoUrl(e.target.value)} placeholder="https://evo.exemplo.com.br" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>API Key</label>
              <input className="input" type="password" value={evoKey} onChange={e => setEvoKey(e.target.value)} placeholder="sua-api-key" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={savingConfig || !evoUrl || !evoKey} style={{ height: 38 }}>
                {evoSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            </div>
          </div>
          {evoConfigured && <div style={{ fontSize: 11, color: '#34C759', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Evolution API configurada</div>}
        </div>
      </section>

      {/* QR Code Panel */}
      {qrInstance && qrInstance.qr_code && qrInstance.status === 'connecting' && (
        <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            <QrCode size={20} style={{ color: '#FFB300' }} />
            <h2 style={{ fontSize: 18, margin: 0 }}>Escaneie o QR Code — {qrInstance.instance_name}</h2>
          </div>
          <div style={{ background: '#fff', display: 'inline-block', padding: 16, borderRadius: 12, marginBottom: 16 }}>
            <img
              src={qrInstance.qr_code.startsWith('data:') ? qrInstance.qr_code : `data:image/png;base64,${qrInstance.qr_code}`}
              alt="QR Code WhatsApp"
              style={{ width: 280, height: 280, display: 'block' }}
            />
          </div>
          <div style={{ fontSize: 13, color: '#9B96B0', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            <p><strong>1.</strong> Abra o WhatsApp no celular</p>
            <p><strong>2.</strong> Toque em <strong>Configuracoes → Aparelhos Conectados → Conectar Aparelho</strong></p>
            <p><strong>3.</strong> Aponte a camera para este QR Code</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => handleRefreshQR(qrInstance)}><RefreshCw size={12} /> Atualizar QR</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(null)}>Fechar</button>
          </div>
        </div>
      )}

      {/* Instances List */}
      {evoConfigured && (
        <section className="dash-section">
          <div className="section-title"><Smartphone size={14} /> Numeros WhatsApp</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {instances.map(inst => (
              <div key={inst.id} className="card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${getStatusColor(inst.status)}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Smartphone size={18} style={{ color: getStatusColor(inst.status) }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{inst.instance_name}</div>
                      {inst.phone_number && <div style={{ fontSize: 12, color: '#C8C4D4' }}>{inst.phone_number}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: getStatusColor(inst.status) }}>
                      {getStatusIcon(inst.status)} {getStatusLabel(inst.status)}
                    </span>
                    {inst.status === 'disconnected' && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleConnect(inst)}><Power size={12} /> Conectar</button>
                    )}
                    {inst.status === 'connecting' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(activeQR === inst.id ? null : inst.id)}>
                        <QrCode size={12} /> {activeQR === inst.id ? 'Ocultar QR' : 'Ver QR'}
                      </button>
                    )}
                    {inst.status === 'connected' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDisconnect(inst)}><PowerOff size={12} /> Desconectar</button>
                    )}
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(inst)} title="Excluir"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            ))}
            {instances.length === 0 && (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <h3>Nenhum numero conectado</h3>
                <p>Clique em "Conectar WhatsApp" para adicionar um numero.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {!evoConfigured && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <Smartphone size={32} style={{ color: '#6B6580', marginBottom: 8 }} />
          <h3>Configure a Evolution API acima</h3>
          <p style={{ color: '#9B96B0', fontSize: 13 }}>Salve a URL e API Key do servidor Evolution para comecar a conectar numeros de WhatsApp.</p>
        </div>
      )}

      {/* New Instance Modal — only asks for name */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Conectar WhatsApp</h2>
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 16 }}>De um nome para identificar este numero (ex: Comercial, Suporte, Vendas).</p>
            <div className="form-group">
              <label>Nome do numero</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Comercial" autoFocus onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? 'Criando...' : 'Gerar QR Code'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
