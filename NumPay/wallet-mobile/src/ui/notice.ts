// One resolver for every toned surface: notices, sheet icon tiles, toasts.
//
// Kept apart from components.tsx so Sheet and Toast can read it without
// importing the whole component barrel (and without the circular import that
// would create, since components.tsx imports Sheet).
//
// "amber" is accepted as an input alias for "caution" because core's
// SendErrorView is SHARED with the extension and still names the tone that way
// (packages/core/src/sendErrors.ts). Mapping it here means the mobile redesign
// costs the extension nothing.
import { colors } from "./theme";

export type NoticeTone = "danger" | "caution" | "info" | "success";
/** What callers may pass, including core's legacy spelling. */
export type NoticeToneInput = NoticeTone | "amber";

export interface ToneColors {
  /** Title and icon. Contrast-checked against `tint` over the page. */
  fg: string;
  /** Panel fill. */
  tint: string;
  /** Panel hairline. */
  line: string;
}

export function noticeTone(tone: NoticeToneInput = "danger"): ToneColors {
  switch (tone) {
    case "amber":
    case "caution":
      return { fg: colors.caution, tint: colors.cautionTint, line: colors.cautionLine };
    case "info":
      return { fg: colors.brand2, tint: colors.brandTint, line: colors.brandLine };
    case "success":
      return { fg: colors.successText, tint: colors.successTint, line: colors.successLine };
    case "danger":
    default:
      return { fg: colors.dangerText, tint: colors.dangerTint, line: colors.dangerLine };
  }
}
