import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

// Shows a picture from the pane's project on the PC: fitted to the screen, tap for full size.
export interface PictureRequest { paneId: string; path: string }
export const isPicturePath = (path: string) => /\.(png|jpe?g|webp|gif)$/i.test(path);
export const pictureUrl = ({ paneId, path }: PictureRequest) =>
  `/api/picture?pane=${encodeURIComponent(paneId)}&path=${encodeURIComponent(path)}`;

export function PictureViewer({ picture, onClose }: { picture?: PictureRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    setError(''); setFull(false);
    if (picture && !element.open) element.showModal();
    if (!picture && element.open) element.close();
  }, [picture]);
  const name = picture?.path.split('/').pop() || '';
  const url = picture ? pictureUrl(picture) : '';
  return <dialog id="picture-viewer" ref={dialog} aria-label={name || 'Picture'} onClose={onClose}>
    <div className="viewer-head">
      <strong title={picture?.path}>{name}</strong>
      {picture && !error ? <a className="icon-button" href={url} download={name} aria-label="Save to phone"><Icon name="download" /></a> : null}
      <button type="button" className="icon-button" aria-label="Close" autoFocus onClick={onClose}><Icon name="close" /></button>
    </div>
    <div className="viewer-body" data-full={full}>
      {error ? <p className="sheet-error" role="alert">{error}</p>
        : picture ? <img src={url} alt={name} onClick={() => setFull(value => !value)} onError={() => {
          // The image element hides the host's reason; ask for it once.
          void fetch(url, { cache: 'no-store' }).then(async response => setError(response.ok ? 'This picture could not be shown.' : await response.text()),
            () => setError('This picture could not be loaded.'));
        }} /> : null}
    </div>
  </dialog>;
}
