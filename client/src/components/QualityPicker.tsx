import { SCREEN_QUALITIES, SCREEN_QUALITY_IDS, isScreenQuality, type ScreenQuality } from "../media/screenQuality";

/** Escolha da qualidade da tela — antes ou durante o compartilhamento. */
export function QualityPicker({ value, onChange }: { value: ScreenQuality; onChange(q: ScreenQuality): void }) {
  return (
    <label className="quality-picker">
      <span>Qualidade</span>
      <select
        aria-label="Qualidade do compartilhamento"
        value={value}
        onChange={(e) => isScreenQuality(e.target.value) && onChange(e.target.value)}
      >
        {SCREEN_QUALITY_IDS.map((q) => (
          <option key={q} value={q}>
            {SCREEN_QUALITIES[q].label}
          </option>
        ))}
      </select>
    </label>
  );
}
