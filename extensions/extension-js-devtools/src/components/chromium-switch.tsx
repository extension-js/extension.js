import * as React from 'react'

type ChromiumSwitchProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string
}

export function ChromiumSwitch({
  className,
  label = 'Developer mode',
  ...props
}: ChromiumSwitchProps) {
  return (
    <div className={`chromium-switch-row ${className || ''}`.trim()} {...props}>
      <style>{`
        .chromium-switch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          padding: 14px 16px;
          border-radius: 14px;
          background: #2a2a2a;
          color: #e8eaed;
          font-size: 16px;
          line-height: 1.2;
        }

        .chromium-switch-label {
          font-weight: 500;
          letter-spacing: 0.01em;
          width: 100%;
          text-align: right;
        }

        .chromium-switch-track {
          position: relative;
          width: 36px;
          height: 20px;
          border-radius: 999px;
          background: #5f6368;
          flex: 0 0 auto;
          animation: chromiumSwitchTrack 3.6s ease-in-out infinite;
        }

        .chromium-switch-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #e8eaed;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
          animation: chromiumSwitchThumb 3.6s ease-in-out infinite;
        }

        @keyframes chromiumSwitchTrack {
          0%,
          45% {
            background: #5f6368;
          }
          55%,
          100% {
            background: #8ab4f8;
          }
        }

        @keyframes chromiumSwitchThumb {
          0%,
          45% {
            transform: translateX(0);
            background: #e8eaed;
          }
          55%,
          100% {
            transform: translateX(16px);
            background: #1a73e8;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .chromium-switch-track,
          .chromium-switch-thumb {
            animation: none;
          }
        }
      `}</style>
      <span className="chromium-switch-label">{label}</span>
      <span className="chromium-switch-track" aria-hidden="true">
        <span className="chromium-switch-thumb" />
      </span>
    </div>
  )
}
