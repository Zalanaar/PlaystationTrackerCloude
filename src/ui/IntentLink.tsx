'use client';

// Пакет 6 (JS главной): ссылка без предзагрузки по попаданию в экран. Next по умолчанию качал JS всех разделов из таббара
// и ссылок первого экрана (~235 КБ на `/`), даже если их не открывали. Здесь раздел подгружается по намерению:
// наведение, касание или фокус (за 100–300 мс до клика), так переход остаётся быстрым, а первый экран — лёгким.
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { forwardRef, useRef, type ComponentProps, type FocusEvent, type MouseEvent, type PointerEvent, type TouchEvent } from 'react';

type Props = ComponentProps<typeof NextLink>;

const IntentLink = forwardRef<HTMLAnchorElement, Props>(function IntentLink({ prefetch, onMouseEnter, onTouchStart, onFocus, onPointerDown, ...rest }, ref) {
  const router = useRouter();
  const done = useRef(false);
  const href = typeof rest.href === 'string' ? rest.href : null;
  const warm = () => {
    if (done.current || href === null || prefetch === false) return;
    done.current = true;
    try { router.prefetch(href); } catch { /* предзагрузка необязательна */ }
  };
  return (
    <NextLink
      ref={ref}
      {...rest}
      prefetch={false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => { warm(); onMouseEnter?.(e); }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => { warm(); onTouchStart?.(e); }}
      onPointerDown={(e: PointerEvent<HTMLAnchorElement>) => { warm(); onPointerDown?.(e); }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => { warm(); onFocus?.(e); }}
    />
  );
});

export default IntentLink;
