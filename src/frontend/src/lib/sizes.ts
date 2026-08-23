/** Display order: conventional small-to-large for UI rendering */
export const SIZE_DISPLAY_ORDER = ['S', 'M', 'L', 'XL'] as const;

/** Preference order: for selecting a default size (most common first) */
export const SIZE_DEFAULT_PREFERENCE = ['M', 'L', 'XL', 'S'] as const;

export const VALID_SIZES = SIZE_DISPLAY_ORDER;
