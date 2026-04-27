/**
 * Apple touch icon (180x180) for iOS home-screen bookmarks.
 *
 * Same approach as `icon.tsx` — render the 🤖 emoji as a PNG so it
 * doesn't fall back to the device's emoji font (which iOS can't use
 * at favicon scale).
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 144,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.22), rgba(124,58,237,0.22))",
          borderRadius: 36,
        }}
      >
        🤖
      </div>
    ),
    { ...size }
  );
}
