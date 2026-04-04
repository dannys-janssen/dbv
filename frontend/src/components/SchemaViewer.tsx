import { useTranslation } from "react-i18next";
import type { SchemaField } from "../api/mongo";

const TYPE_COLORS: Record<string, string> = {
  string: "#2563eb",
  int32: "#7c3aed",
  int64: "#7c3aed",
  double: "#7c3aed",
  decimal128: "#7c3aed",
  bool: "#d97706",
  date: "#059669",
  objectId: "#9333ea",
  object: "#64748b",
  array: "#0891b2",
  null: "#dc2626",
  binary: "#6b7280",
  timestamp: "#059669",
  regex: "#b45309",
  other: "#6b7280",
};

interface Props {
  fields: SchemaField[];
  sampledDocs: number;
}

export default function SchemaViewer({ fields, sampledDocs }: Props) {
  const { t } = useTranslation();
  return (
    <div style={styles.container}>
      <p style={styles.meta}>
        {t("schema.summary", {
          docCount: sampledDocs,
          docPlural: sampledDocs !== 1 ? t("schema.plural.documents") : "",
          fieldCount: fields.length,
          fieldPlural: fields.length !== 1 ? t("schema.plural.fields") : "",
        })}
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>{t("table.header.fieldPath")}</th>
            <th style={styles.th}>{t("table.header.types")}</th>
            <th style={{ ...styles.th, textAlign: "right" }}>{t("table.header.coverage")}</th>
            <th style={{ ...styles.th, textAlign: "center" }}>{t("table.header.nullable")}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.path} style={styles.row}>
              <td style={styles.td}>
                <code style={styles.fieldName}>{f.path}</code>
              </td>
              <td style={styles.td}>
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  {f.types.map((t) => (
                    <span
                      key={t}
                      style={{
                        ...styles.badge,
                        background: TYPE_COLORS[t] ?? "#6b7280",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </td>
              <td style={{ ...styles.td, textAlign: "right" }}>
                <div style={styles.coverageBar}>
                  <div
                    style={{
                      ...styles.coverageFill,
                      width: `${Math.round(f.coverage * 100)}%`,
                    }}
                  />
                  <span style={styles.coverageLabel}>
                    {Math.round(f.coverage * 100)}%
                  </span>
                </div>
              </td>
              <td style={{ ...styles.td, textAlign: "center" }}>
                {f.nullable ? "⚠️" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { overflowX: "auto" },
  meta: { fontSize: "0.85rem", color: "#666", marginBottom: "0.75rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" },
  th: {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    borderBottom: "2px solid #e5e7eb",
    color: "#374151",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  row: { borderBottom: "1px solid #f3f4f6" },
  td: { padding: "0.4rem 0.75rem", verticalAlign: "middle", textAlign: "left" },
  fieldName: {
    fontFamily: "monospace",
    fontSize: "0.82rem",
    background: "#f3f4f6",
    color: "#1e293b",
    padding: "0.1rem 0.35rem",
    borderRadius: "3px",
  },
  badge: {
    color: "#fff",
    fontSize: "0.72rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "3px",
    fontWeight: 500,
  },
  coverageBar: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    width: "120px",
    justifyContent: "flex-end",
  },
  coverageFill: {
    height: "6px",
    borderRadius: "3px",
    background: "#3b82f6",
    minWidth: "2px",
  },
  coverageLabel: { fontSize: "0.8rem", color: "#374151", minWidth: "2.5rem", textAlign: "right" },
};
