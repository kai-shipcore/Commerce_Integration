"use client";

type MarketplacePlatform = "shopify" | "amazon" | "ebay" | "walmart";

interface MarketplaceIconProps {
  platform: MarketplacePlatform | string;
  className?: string;
}

const baseClassName =
  "flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm";

export function MarketplaceIcon({
  platform,
  className = "",
}: MarketplaceIconProps) {
  const wrapperClassName = `${baseClassName} ${className}`.trim();

  if (platform === "shopify") {
    return (
      <div className={wrapperClassName}>
        <svg viewBox="0 0 44 44" className="h-8 w-8" aria-hidden="true">
          <path
            d="M11 15.5c.3-2.7 2.4-4.8 5.1-5.1l11.6-1.1c3-.3 5.6 2 5.9 5l1.4 15.2c.3 3.4-2.4 6.3-5.8 6.3H14.8c-3.4 0-6.1-2.9-5.8-6.3L11 15.5Z"
            fill="#95BF47"
          />
          <path
            d="M17.2 14.6c0-3.4 2.1-6.4 4.8-6.4s4.8 3 4.8 6.4"
            fill="none"
            stroke="#5E8E3E"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M24.4 17.6c-1-.5-2.4-.8-3.6-.8-3 0-5.2 1.7-5.2 4.2 0 1.8 1.3 3.1 3.2 4.1 1.7.9 2.3 1.4 2.3 2.2 0 .9-.8 1.5-2.2 1.5-1.3 0-2.6-.4-3.6-.9l-.7 2.8c1 .5 2.6.9 4.2.9 3.4 0 5.6-1.7 5.6-4.4 0-1.8-1-3-3.1-4.1-1.7-.9-2.4-1.4-2.4-2.2 0-.7.7-1.3 2-1.3 1.1 0 2 .3 2.8.7l.7-2.7Z"
            fill="#fff"
          />
        </svg>
      </div>
    );
  }

  if (platform === "amazon") {
    return (
      <div className={wrapperClassName}>
        <svg viewBox="0 0 44 44" className="h-8 w-8" aria-hidden="true">
          <text
            x="5.5"
            y="22"
            fontSize="11.5"
            fontWeight="700"
            letterSpacing="-0.5"
            fill="#111111"
          >
            amazon
          </text>
          <path
            d="M11 27.8c3.8 2.4 8 3.6 12.5 3.6 3.2 0 6.4-.6 9.4-1.8"
            fill="none"
            stroke="#FF9900"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="m29.8 27.8 4.4-.3-2.1 3.8"
            fill="none"
            stroke="#FF9900"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  if (platform === "ebay") {
    return (
      <div className={wrapperClassName}>
        <svg viewBox="0 0 44 44" className="h-8 w-8" aria-hidden="true">
          <text x="5.5" y="26.5" fontSize="14" fontWeight="700" fill="#E53238">
            e
          </text>
          <text x="14" y="27" fontSize="15" fontWeight="700" fill="#0064D2">
            b
          </text>
          <text x="23.8" y="27" fontSize="15" fontWeight="700" fill="#F5AF02">
            a
          </text>
          <text x="31.5" y="26.5" fontSize="14" fontWeight="700" fill="#86B817">
            y
          </text>
        </svg>
      </div>
    );
  }

  if (platform === "walmart") {
    return (
      <div className={wrapperClassName}>
        <svg viewBox="0 0 44 44" className="h-8 w-8" aria-hidden="true">
          <circle cx="22" cy="22" r="3.2" fill="#0071CE" />
          <path d="M22 8.5v7" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
          <path d="M22 28.5v7" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
          <path d="m10.3 14.2 6 3.5" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
          <path d="m27.7 24.3 6 3.5" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
          <path d="m10.3 29.8 6-3.5" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
          <path d="m27.7 19.7 6-3.5" stroke="#FFC220" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <span className="text-sm font-semibold text-slate-600">
        {platform.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}
