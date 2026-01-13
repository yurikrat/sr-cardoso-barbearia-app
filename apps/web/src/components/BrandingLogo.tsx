import { useBranding } from '@/hooks/useBranding';
import type { CSSProperties } from 'react';

const FALLBACK_LOGO = '/logo.png';

interface BrandingLogoProps {
  alt?: string;
  className?: string;
  style?: CSSProperties;
}

export function BrandingLogo({ alt = 'Sr. Cardoso Barbearia', className, style }: BrandingLogoProps) {
  const { logoSrc } = useBranding();

  return (
    <img
      src={logoSrc}
      alt={alt}
      className={className}
      style={style}
      onError={(e) => {
        const img = e.currentTarget;
        if (img.src !== FALLBACK_LOGO && !img.src.endsWith(FALLBACK_LOGO)) {
          img.src = FALLBACK_LOGO;
        }
      }}
    />
  );
}
