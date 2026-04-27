/**
 * App icon (favicon).
 *
 * Next.js 15 detects this file and emits the appropriate <link rel="icon">
 * tag automatically. Rendering through `ImageResponse` bakes the emoji
 * into a PNG so it shows up identically on every platform — Windows,
 * macOS, Linux, iOS, Android — regardless of the local emoji font.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 26,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(124,58,237,0.18))",
          borderRadius: 6,
        }}
      >
        🤖
      </div>
    ),
    { ...size }
  );
}
