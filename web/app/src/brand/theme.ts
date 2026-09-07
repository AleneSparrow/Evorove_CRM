export const PRODUCT_NAME = "Evorove";
export const DOCUMENT_TITLE = "Evorove — every lead. no dead air.";

/** Pulse visual system. Import this object (or the Tailwind aliases of the
 * same hexes) instead of inventing new colors in screens. */
export const brand = {
  cream: "#F7F1E4",
  ink: "#0B0B0D",
  coral: "#FF5A36",
  coralWash: "#FFE8E1",
  /** Contrast-safe coral for small text/slots on white (~5.3:1). */
  coralDeep: "#C73618",
  lime: "#C6FF00",
  limeWash: "#EEFF99",
  limeInk: "#4A4A00",
  clay: "#9A8F83",
  mute: "#6B6459",
  line: "#E4DCCB",
  panel: "#FFFCF6",
} as const;
