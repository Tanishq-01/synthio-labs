/**
 * SlideNav - Navigation indicators and controls
 */

export default function SlideNav({
  currentSlide,
  totalSlides,
  onNavigate,
  disabled,
}) {
  return (
    <div className="slide-nav">
      <button
        className="nav-btn prev"
        onClick={() => onNavigate(currentSlide - 1)}
        disabled={disabled || currentSlide <= 1}
      >
        ← Prev
      </button>

      <div className="slide-indicators">
        {Array.from({ length: totalSlides }, (_, i) => i + 1).map((num) => (
          <button
            key={num}
            className={`indicator ${num === currentSlide ? "active" : ""}`}
            onClick={() => onNavigate(num)}
            disabled={disabled}
          >
            {num}
          </button>
        ))}
      </div>

      <button
        className="nav-btn next"
        onClick={() => onNavigate(currentSlide + 1)}
        disabled={disabled || currentSlide >= totalSlides}
      >
        Next →
      </button>

      <span className="slide-counter">
        {currentSlide} / {totalSlides}
      </span>
    </div>
  );
}
