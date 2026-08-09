import { useMemo, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';

async function preparedFile(source: string, crop: Area, rotation: number, originalName: string): Promise<File> {
  const image = new Image(); image.src = source; await image.decode();
  const radians = rotation * Math.PI / 180; const horizontal = Math.abs(Math.cos(radians)); const vertical = Math.abs(Math.sin(radians));
  const width = Math.ceil(image.width * horizontal + image.height * vertical); const height = Math.ceil(image.width * vertical + image.height * horizontal);
  const rotated = document.createElement('canvas'); rotated.width = width; rotated.height = height;
  const context = rotated.getContext('2d', { alpha: false }); if (!context) throw new Error('Image preparation is unavailable.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.translate(width / 2, height / 2); context.rotate(radians); context.drawImage(image, -image.width / 2, -image.height / 2);
  const output = document.createElement('canvas'); output.width = crop.width; output.height = crop.height;
  const outputContext = output.getContext('2d', { alpha: false }); if (!outputContext) throw new Error('Image preparation is unavailable.');
  outputContext.drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error('Image could not be prepared.')), 'image/webp', .88));
  return new File([blob], originalName.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

export function ImagePrepare({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (file: File) => void }) {
  const source = useMemo(() => URL.createObjectURL(file), [file]); const [crop, setCrop] = useState({ x: 0, y: 0 }); const [zoom, setZoom] = useState(1); const [rotation, setRotation] = useState(0); const [pixels, setPixels] = useState<Area | null>(null); const [busy, setBusy] = useState(false);
  async function confirm() { if (!pixels) return; setBusy(true); try { onConfirm(await preparedFile(source, pixels, rotation, file.name)); } finally { URL.revokeObjectURL(source); setBusy(false); } }
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="prepare-title"><section className="prepare"><h2 id="prepare-title">Prepare invoice</h2><div className="crop"><Cropper image={source} crop={crop} zoom={zoom} rotation={rotation} aspect={4/5} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, area) => setPixels(area)} /></div><label>Zoom<input type="range" min="1" max="3" step=".1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><div className="modal-actions"><button className="secondary" onClick={() => setRotation((value) => (value + 90) % 360)}>Rotate</button><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Preparing…' : 'Use image'}</button></div></section></div>;
}
