import { useState, useEffect } from 'react'
import { User, Camera } from 'lucide-react'
import { getAvatarBase64, pickAvatarFile, saveAvatar } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

interface Props {
  avatarPath: string
  onAvatarChanged: (path: string) => void
}

export function AvatarUpload({ avatarPath, onAvatarChanged }: Props) {
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    if (avatarPath) {
      getAvatarBase64().then(b64 => setAvatarDataUrl(b64))
    } else {
      setAvatarDataUrl(null)
    }
  }, [avatarPath])

  const handlePickAndUpload = async () => {
    const filePath = await pickAvatarFile()
    if (!filePath) return

    const result = await saveAvatar(filePath)
    if (result.success) {
      const b64 = await getAvatarBase64()
      setAvatarDataUrl(b64)
      onAvatarChanged(result.path)
      showToast({ type: 'info', message: '头像已更新' })
    }
  }

  return (
    <div className="relative group shrink-0">
      <button
        onClick={handlePickAndUpload}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="w-24 h-24 rounded-full overflow-hidden border-2 border-[var(--border-color)] bg-[var(--bg-tertiary)] flex items-center justify-center transition-colors hover:border-[var(--accent)] cursor-pointer"
        title="点击更换头像"
      >
        {avatarDataUrl ? (
          <img src={avatarDataUrl} alt="头像" className="w-full h-full object-cover" />
        ) : (
          <User size={42} className="text-[var(--text-muted)]" strokeWidth={1} />
        )}

        {hover && (
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center transition-opacity">
            <Camera size={22} className="text-white" />
          </div>
        )}
      </button>
    </div>
  )
}
