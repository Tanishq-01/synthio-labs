/**
 * SlideViewer - Displays the current slide content
 */

export default function SlideViewer({ slide, isLoading }) {
  if (isLoading) {
    return (
      <div className="slide-viewer loading">
        <div className="slide-content">
          <p>Loading slides...</p>
        </div>
      </div>
    );
  }

  if (!slide) {
    return (
      <div className="slide-viewer empty">
        <div className="slide-content">
          <p>No slide to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="slide-viewer">
      <div className="slide-content">
        <h1 className="slide-title">{slide.title}</h1>
        <ul className="slide-points">
          {slide.content.map((point, index) => (
            <li key={index} className="slide-point">
              {point}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
