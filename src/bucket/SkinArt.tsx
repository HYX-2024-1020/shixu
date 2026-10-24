import type { Skin } from "./skins";

// Native artwork keeps the collection sharp at any size and available offline.
export default function SkinArt({ skin }: { skin: Skin }) {
  if (skin.art === "whale" || skin.art === "custom")
    return (
      <img
        className="skin-art"
        src={
          skin.art === "whale"
            ? import.meta.env.BASE_URL + "mascot.png"
            : skin.image
        }
        alt={skin.name}
        draggable={false}
      />
    );
  const face = (
    <g stroke="#202022" strokeWidth="4" strokeLinecap="round" fill="none">
      <path d="M99 131v6m42-6v6" />
      <path d="M111 149q9 9 18 0" />
      <path d="M83 145h10m54 0h10" stroke="#f19aa4" strokeWidth="7" />
    </g>
  );
  return (
    <svg
      className="skin-art"
      viewBox="0 0 240 240"
      role="img"
      aria-label={skin.name}
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse
        cx="120"
        cy="218"
        rx="62"
        ry="9"
        style={{ fill: "#202022" }}
        opacity=".1"
      />
      <g
        stroke="#202022"
        strokeWidth="4.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {skin.art === "cat" && (
          <>
            <path
              d="M60 168Q13 171 28 134q5-13 13-9"
              fill="none"
              stroke="#efa44f"
              strokeWidth="15"
            />
            <path
              d="M70 105 63 47l43 30q16-5 30 0l42-30-5 61q23 25 15 61-6 37-68 39-61-1-69-39-7-37 19-64Z"
              fill="#ffbd6b"
            />
            <path
              d="m72 63 4 25 15-8m76-17-4 25-15-8"
              fill="#ffdeb5"
              stroke="none"
            />
            <path d="m109 89 2 12m20-12-2 12" stroke="#d58a39" />
            <ellipse
              cx="120"
              cy="181"
              rx="35"
              ry="24"
              style={{ fill: "#ffe5ba" }}
              stroke="none"
            />
            <path
              d="m68 134 16 4m-17 10 16-1m73-9 16-4m-16 13 17 1"
              strokeWidth="3"
            />
            {face}
          </>
        )}
        {skin.art === "sprout" && (
          <>
            <path d="M120 97V56" fill="none" stroke="#438953" />
            <path d="M119 70Q73 70 72 33q43-4 47 37Z" fill="#9ed27d" />
            <path d="M121 59q-1-39 47-37 0 37-47 37Z" fill="#71b962" />
            <path d="M60 104h120l-15 91q-45 28-90 0Z" fill="#d7946f" />
            <rect x="53" y="89" width="134" height="29" rx="9" fill="#efb38c" />
            {face}
            <path d="m77 177-15 7m101-7 15 7" fill="none" />
          </>
        )}
        {skin.art === "robot" && (
          <>
            <path d="M120 72V48" />
            <circle cx="120" cy="37" r="11" fill="#ffd43b" />
            <rect x="42" y="112" width="20" height="41" rx="8" fill="#a99bd8" />
            <rect
              x="178"
              y="112"
              width="20"
              height="41"
              rx="8"
              fill="#a99bd8"
            />
            <rect
              x="59"
              y="73"
              width="122"
              height="113"
              rx="28"
              fill="#bcb0ee"
            />
            <rect x="75" y="97" width="90" height="60" rx="14" fill="#f3f5ed" />
            <path d="M96 117v14m48-14v14" stroke="#6853ab" strokeWidth="8" />
            <path d="M112 140h16" />
            <path d="M86 187v20m68-20v20" strokeWidth="15" />
            <circle cx="109" cy="171" r="3" fill="#ffd43b" stroke="none" />
            <circle cx="130" cy="171" r="3" fill="#fff" stroke="none" />
          </>
        )}
        {skin.art === "ghost" && (
          <>
            <path
              d="M54 180q6-105 66-105t66 105l-8 20-21-12-18 15-19-13-20 13-19-15-20 12Z"
              fill="#fbf8ff"
            />
            <path d="M58 133q-22 4-24 25m148-25q22 4 24 25" fill="none" />
            {face}
            <path
              d="m168 49 5 10 11 4-11 4-5 11-4-11-11-4 11-4Z"
              fill="#bda6f5"
              strokeWidth="2"
            />
          </>
        )}
        {skin.art === "rabbit" && (
          <>
            <path
              d="M88 105Q48 17 79 20q22-1 30 81m22-1q5-82 29-79 30 8-7 85"
              fill="#fff3ee"
            />
            <path
              d="m82 43 13 43m59-43-10 43"
              stroke="#f2adbc"
              strokeWidth="9"
            />
            <path
              d="M65 119q14-29 55-29t55 29q19 40 1 66-17 23-56 23t-56-23q-18-26 1-66Z"
              fill="#fff3ee"
            />
            {face}
            <path d="M103 197q17-17 34 0" fill="#ffd9df" />
          </>
        )}
        {skin.art === "planet" && (
          <>
            <circle cx="120" cy="128" r="65" fill="#9fb9f4" />
            <path
              d="M63 98q38-15 73 5m-69 65q20-9 30-5"
              fill="none"
              stroke="#7a9bdf"
              strokeWidth="8"
            />
            <path
              d="M58 109q-48 28-24 45 34 28 128-7 74-28 41-46-8-5-24-4"
              fill="none"
              stroke="#202022"
              strokeWidth="17"
            />
            <path
              d="M58 109q-48 28-24 45 34 28 128-7 74-28 41-46-8-5-24-4"
              fill="none"
              stroke="#ffda77"
              strokeWidth="9"
            />
            <path d="M104 102v6m34-14v6m-22 19q8 5 14-3" fill="none" />
            <path
              d="m181 40 4 10 11 4-11 4-4 11-4-11-11-4 11-4Z"
              fill="#ffda77"
              strokeWidth="2"
            />
          </>
        )}
        {skin.art === "pudding" && (
          <>
            <path
              d="M75 85q45-21 90 0l28 100q-5 23-73 23t-73-23Z"
              fill="#ffdd77"
            />
            <path
              d="M75 85q45-21 90 0l6 25q-17 9-23-3-7-12-15 1-15 22-26-1-8-12-16 2-8 10-22 1Z"
              fill="#bd784f"
            />
            <ellipse
              cx="120"
              cy="85"
              rx="45"
              ry="13"
              style={{ fill: "#d99564" }}
            />
            {face}
            <path d="m114 63 7-15 8 15Z" fill="#ef8a97" strokeWidth="3" />
          </>
        )}
      </g>
    </svg>
  );
}
