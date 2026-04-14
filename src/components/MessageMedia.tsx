import { useState } from 'react'
import { fetchMessageMedia, type Message } from '../lib/api'
import { Image as ImageIcon, Film, Mic, FileText, Sticker, Eye, Loader, Download } from 'lucide-react'

interface Props {
  message: Message
  leadId: number
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  document: FileText,
  sticker: Sticker,
}

const LABEL_MAP: Record<string, string> = {
  image: 'Imagem',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
  sticker: 'Sticker',
}

export default function MessageMedia({ message, leadId }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [mime, setMime] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const Icon = ICON_MAP[message.media_type] || FileText
  const label = LABEL_MAP[message.media_type] || 'Arquivo'

  const handleLoad = async () => {
    if (dataUrl || loading) return
    setLoading(true); setError(false)
    try {
      const data = await fetchMessageMedia(leadId, message.id)
      setDataUrl(data.dataUrl); setMime(data.mime)
    } catch { setError(true) }
    setLoading(false)
  }

  // Render loaded media
  if (dataUrl) {
    if (mime.startsWith('image/')) {
      return (
        <a href={dataUrl} target="_blank" rel="noopener noreferrer">
          <img src={dataUrl} alt={label} style={{ maxWidth: 280, maxHeight: 280, borderRadius: 8, display: 'block', cursor: 'zoom-in' }} />
        </a>
      )
    }
    if (mime.startsWith('video/')) {
      return <video src={dataUrl} controls style={{ maxWidth: 280, borderRadius: 8 }} />
    }
    if (mime.startsWith('audio/')) {
      return <audio src={dataUrl} controls style={{ maxWidth: 280 }} />
    }
    // Document/other → download link
    return (
      <a href={dataUrl} download={message.content || 'arquivo'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, color: 'inherit', textDecoration: 'none' }}>
        <Download size={14} /> {message.content || label}
      </a>
    )
  }

  // Placeholder with click-to-load
  return (
    <button
      onClick={handleLoad}
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.2)',
        color: 'inherit', cursor: loading ? 'wait' : 'pointer', fontSize: 13, minWidth: 180,
      }}
    >
      {loading ? <Loader size={14} className="spinning" /> : error ? <Icon size={14} /> : <Eye size={14} />}
      <span>{loading ? 'Carregando...' : error ? `Erro ao carregar ${label.toLowerCase()}` : `Ver ${label.toLowerCase()}`}</span>
      {message.content && message.content !== `[${label}]` && <span style={{ opacity: 0.7, fontSize: 11 }}>· {message.content}</span>}
    </button>
  )
}
