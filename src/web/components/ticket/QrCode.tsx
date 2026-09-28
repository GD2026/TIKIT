import { memo, useMemo } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a QR code as one SVG path (runs of dark modules merged per row). Always black on white –
 * scanners need the contrast regardless of light or dark appearance.
 */
export const QrCode = memo(function QrCode({ value, className, label, margin = 1 }: { value: string; className?: string; label?: string; margin?: number }) {
  const { d, size } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const data = qr.modules.data;
    let path = '';
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (data[y * n + x]) {
          let run = 1;
          while (x + run < n && data[y * n + x + run]) run++;
          path += `M${x} ${y}h${run}v1h-${run}z`;
          x += run;
        } else x++;
      }
    }
    return { d: path, size: n };
  }, [value]);
  const box = size + margin * 2;
  return (
    <svg viewBox={`${-margin} ${-margin} ${box} ${box}`} shapeRendering="crispEdges" className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x={-margin} y={-margin} width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
});
