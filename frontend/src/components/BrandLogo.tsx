import type { CSSProperties } from 'react';

type BrandLogoProps = {
  size?: number;
  className?: string;
};

/** The supplied artwork has generous white margins; scale it inside a white tile to frame the mark. */
export function BrandLogo({ size = 36, className = '' }: BrandLogoProps) {
  const style = { width: size, height: size } as CSSProperties;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ${className}`}
      style={style}
    >
      <img
        src="/merokosh-logo.png"
        alt=""
        aria-hidden="true"
        className="h-full w-full max-w-none object-cover"
        style={{ transform: 'scale(1.92)' }}
      />
    </span>
  );
}
