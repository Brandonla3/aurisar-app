import Sheet from './Sheet';

/**
 * The one confirmation dialog. Replaces window.confirm and the ad-hoc
 * inline confirm modals: centered card on the confirm layer (tops every
 * other overlay), Cancel + Confirm with ≥44px targets, `danger` switches
 * the confirm action to the destructive style.
 */
export default function ConfirmSheet({
  open,
  icon,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      layer={'confirm'}
      placement={'center'}
      maxWidth={380}
      showClose={false}
      showHandle={false}
      ariaLabel={title}
    >
      <div className={'ui-confirm-title'}>
        {icon && <span className={'ui-confirm-icon'}>{icon}</span>}
        {title}
      </div>
      {body && <div className={'ui-confirm-body'}>{body}</div>}
      <div className={'ui-confirm-actions'}>
        <button className={'btn btn-ghost ui-confirm-btn'} style={{ flex: 1 }} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-gold-solid'} ui-confirm-btn`}
          style={{ flex: 2 }}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
