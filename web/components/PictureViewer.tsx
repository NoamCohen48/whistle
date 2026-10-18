import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { errorMessage, request } from '../request.ts';

// Shows a picture from the pane's project on the PC: fitted to the screen, tap for full size.
export interface PictureRequest { paneId: string; path: string }
export const isPicturePath = (path: string) => /\.(png|jpe?g|webp|gif)$/i.test(path);
export const pictureUrl = ({ paneId, path }: PictureRequest) =>
  `/api/picture?pane=${encodeURIComponent(paneId)}&path=${encodeURIComponent(path)}`;

export function PictureViewer({ picture, onClose }: { picture?: PictureRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = useRef(picture);
  current.current = picture;
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
      {error ? <div className="picture-error"><p className="sheet-error" role="alert">{error}</p><button type="button" onClick={() => { setError(''); setRevision(value => value + 1); }}>Retry picture</button></div>
        : picture ? <img key={`${url}:${revision}`} src={url} alt={name} tabIndex={0} role="button" aria-label={`${name}, ${full ? 'fit to screen' : 'view full size'}`} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFull(value => !value); }
        }} onClick={() => setFull(value => !value)} onError={() => {
          // The image element hides the host's reason; ask for it once.
          void request(url).then(() => { if (current.current === picture) setError('This picture could not be shown. Retry, or check the file on your PC.'); },
            cause => { if (current.current === picture) setError(errorMessage(cause)); });
        }} /> : null}
    </div>
  </dialog>;
}
