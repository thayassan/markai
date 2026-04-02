import React from 'react';

export function StudentBadge({ name, studentCode }: { name: string; studentCode?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 500 }}>{name}</span>
      {studentCode && (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 20,
          background: "var(--color-background-secondary, #f1f5f9)",
          color: "var(--color-text-secondary, #64748b)",
          border: "0.5px solid var(--color-border-tertiary, #e2e8f0)",
          letterSpacing: "0.3px",
        }}>
          {studentCode}
        </span>
      )}
    </div>
  );
}
