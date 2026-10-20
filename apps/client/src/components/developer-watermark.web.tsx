export function DeveloperWatermark() {
  return (
    <span className="developer-watermark-slot">
      <a
        className="developer-watermark"
        href="https://tymabee.ca/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Built by Ty, visit developer website, opens in a new tab"
      >
        <span className="wordmark">
          <span className="base-ink">Built by Ty</span>
          <span className="ink-fill" aria-hidden="true">
            Built by Ty
          </span>
          <svg
            className="stroke"
            viewBox="0 0 120 14"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M4 9 C30 3 55 12 82 6 S112 9 116 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="arrow" aria-hidden="true">
          ↗
        </span>
      </a>
    </span>
  );
}
