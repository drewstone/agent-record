/** Temporary composition comparison on the real run route; removed after the chosen direction lands. */
export const RUN_DESIGN_VARIANTS = [
  ['workspace', 'Workspace', 'Tree, artifact and evidence together'],
  ['document', 'Document', 'Read the result; open files when needed'],
  ['review', 'Review', 'Original brief beside version comparison'],
] as const
export type RunDesignVariant = typeof RUN_DESIGN_VARIANTS[number][0]
export const runDesignVariant = (value: string | null) => RUN_DESIGN_VARIANTS.find(([id]) => id === value)?.[0] ?? null

export function RunDesignPreview({ value, onChange }: { value: RunDesignVariant; onChange: (value: RunDesignVariant) => void }) {
  return <nav className="run-design-preview" aria-label="Design comparison">
    <span>Design preview</span>
    {RUN_DESIGN_VARIANTS.map(([id, label, detail]) => <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)} title={detail}>{label}<small>{detail}</small></button>)}
  </nav>
}
