import { createPortal } from 'react-dom';
import { useModalLifecycle } from '../../utils/useModalLifecycle';
import { Z } from '../../utils/tokens';

// Layer names → the Z ladder in tokens.js (mirrored as --z-* in app.css).
const LAYER_Z = {
  picker: Z.picker,
  editor: Z.editor,
  modal: Z.modal,
  detail: Z.detail,
  confirm: Z.confirm,
  live: Z.live,
};

/**
 * The one modal/sheet shell. Every overlay in the fitness tabs renders
 * through this so backdrop opacity, corner radius, entry motion, z-order,
 * Escape/inert handling (useModalLifecycle), safe-area padding and the
 * close affordance are decided once.
 *
 * Layout contract: the sheet is a column of [handle?, header?, body, footer?]
 * where the body is the ONLY scroller (`scroll="body"`, default). Callers
 * must not nest a second vertical scroller inside the body; a caller that
 * manages its own scroller (e.g. a virtualized list) passes `scroll="none"`
 * and the body becomes overflow:hidden.
 *
 * `placement="bottom"` is the mobile-first default; `"center"` is for the
 * few dialogs whose character is a centered card (completion, confirms).
 */
export default function Sheet({
  open,
  onClose,
  layer = 'modal',            // key of LAYER_Z, or an explicit z number
  placement = 'bottom',       // "bottom" | "center"
  title,
  icon,
  titleFont,                  // "cinzel" opts into the serif display face
  headerLeft,                 // slot before the title (e.g. a Back button)
  headerRight,                // slot between title and the close X
  showClose = true,
  showHandle = true,          // bottom placement only
  footer,                     // pinned below the body, safe-area padded
  maxWidth = 520,
  tall = false,               // 92dvh cap instead of 85dvh
  navOffset = true,           // keep the sheet above the bottom tab bar
  scroll = 'body',            // "body" | "none"
  ariaLabel,
  sheetRef,                   // passthroughs for swipe pagers etc.
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onAnimationEnd,
  className = '',
  bodyClassName = '',
  children,
}) {
  useModalLifecycle(!!open, onClose);
  if (!open) return null;

  const zIndex = typeof layer === 'number' ? layer : (LAYER_Z[layer] ?? Z.modal);
  const isBottom = placement === 'bottom';

  // Touch/animation passthroughs are spread so a sheet without a swipe pager
  // carries no listeners at all.
  const passthrough = {};
  if (onTouchStart) passthrough.onTouchStart = onTouchStart;
  if (onTouchMove) passthrough.onTouchMove = onTouchMove;
  if (onTouchEnd) passthrough.onTouchEnd = onTouchEnd;
  if (onAnimationEnd) passthrough.onAnimationEnd = onAnimationEnd;

  return createPortal(
    <div
      role="presentation"
      className={`ui-sheet-backdrop ${isBottom ? 'ui-sheet-backdrop--bottom' : 'ui-sheet-backdrop--center'}${isBottom && navOffset ? ' ui-sheet-backdrop--nav' : ''}`}
      style={{ zIndex }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || undefined}
        ref={sheetRef}
        className={`ui-sheet ${isBottom ? 'ui-sheet--bottom sheet-slide-up' : 'ui-sheet--center ui-sheet-pop'}${tall ? ' ui-sheet--tall' : ''} ${className}`}
        style={{ maxWidth }}
        {...passthrough}
      >
        {isBottom && showHandle && <div className={'ui-sheet-handle'} aria-hidden={'true'} />}
        {(title || headerLeft || headerRight || showClose) && (
          <div className={'ui-sheet-header'}>
            {headerLeft}
            <div className={`ui-sheet-title${titleFont === 'cinzel' ? ' ui-sheet-title--cinzel' : ''}`}>
              {icon && <span className={'ui-sheet-title-icon'}>{icon}</span>}
              {title}
            </div>
            {headerRight}
            {showClose && (
              <button className={'ui-sheet-close'} aria-label={'Close'} onClick={onClose}>
                {'✕'}
              </button>
            )}
          </div>
        )}
        <div className={`ui-sheet-body${scroll === 'none' ? ' ui-sheet-body--fixed' : ''} ${bodyClassName}`}>
          {children}
        </div>
        {footer && <div className={'ui-sheet-footer'}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
