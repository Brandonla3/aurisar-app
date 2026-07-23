/**
 * A small glyph action with a full-size touch target. The button box itself
 * is 44×44 (so stacked instances can never overlap hit areas — the failure
 * mode of the ::before extension trick), while the visible affordance is a
 * compact centered chip.
 */
export default function IconButton({
  label,            // required accessible name; also the tooltip
  onClick,
  disabled = false,
  size = 28,        // visual chip size; the hit area stays 44
  className = '',
  style,
  glyphStyle,
  children,
  ...rest
}) {
  return (
    <button
      type={'button'}
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={style}
      {...rest}
    >
      <span
        className={'icon-btn-glyph'}
        style={{ width: size, height: size, ...glyphStyle }}
        aria-hidden={'true'}
      >
        {children}
      </span>
    </button>
  );
}
