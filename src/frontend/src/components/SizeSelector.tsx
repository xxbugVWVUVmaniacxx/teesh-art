interface Props {
  sizes: Record<string, { available: boolean }>;
  selectedSize: string | null;
  onSizeChange: (size: string) => void;
}

const SIZE_DISPLAY_ORDER = ['S', 'M', 'L', 'XL'] as const;

export default function SizeSelector({ sizes, selectedSize, onSizeChange }: Props) {
  return (
    <div className="size-selector">
      {SIZE_DISPLAY_ORDER.map((size) => {
        const available = sizes[size]?.available ?? false;
        const selected = size === selectedSize;

        let className = 'size-pill';
        if (!available) {
          className += ' size-pill--unavailable';
        } else if (selected) {
          className += ' size-pill--selected';
        }

        return (
          <button
            key={size}
            type="button"
            className={className}
            onClick={() => available && onSizeChange(size)}
            aria-disabled={!available}
            aria-pressed={selected}
            aria-label={`Size ${size}${!available ? ' (unavailable)' : ''}`}
          >
            {size}
          </button>
        );
      })}
    </div>
  );
}
