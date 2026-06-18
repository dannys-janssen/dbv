import { useTranslation } from "react-i18next";
import { useTheme, type Theme } from "@mui/material/styles";
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
  const muiTheme = useTheme();
  const styles = getStyles(muiTheme);
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
        <caption className="sr-only">Schema fields</caption>
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
                  {f.types.map((typeName) => (
                    <span
                      key={typeName}
                      style={{
                        ...styles.badge,
                        background: TYPE_COLORS[typeName] ?? "#6b7280",
                      }}
                      aria-label={`Type: ${typeName}`}
                    >
                      {typeName}
                    </span>
                  ))}
                </div>
              </td>
              <td style={{ ...styles.td, textAlign: "right" }}>
                <div
                  style={styles.coverageBar}
                  role="img"
                  aria-label={`Coverage: ${Math.round(f.coverage * 100)}%`}
                >
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
                {f.nullable
                  ? <span aria-label={t("schema.label.nullable")} title={t("schema.label.nullable")}>⚠️</span>
                  : <span aria-hidden="true">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getStyles(muiTheme: Theme): Record<string, React.CSSProperties> {
  return {
    container: { overflowX: "auto" },
    meta: { fontSize: "0.85rem", color: muiTheme.palette.text.secondary, marginBottom: "0.75rem" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" },
    th: {
      textAlign: "left",
      padding: "0.5rem 0.75rem",
      borderBottom: `2px solid ${muiTheme.palette.divider}`,
      color: muiTheme.palette.text.secondary,
      fontWeight: 600,
      whiteSpace: "nowrap",
    },
    row: { borderBottom: `1px solid ${muiTheme.palette.divider}` },
    td: { padding: "0.4rem 0.75rem", verticalAlign: "middle", textAlign: "left", color: muiTheme.palette.text.primary },
    fieldName: {
      fontFamily: "monospace",
      fontSize: "0.82rem",
      background: muiTheme.palette.action.hover,
      color: muiTheme.palette.text.primary,
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
      background: muiTheme.palette.primary.main,
      minWidth: "2px",
    },
    coverageLabel: { fontSize: "0.8rem", color: muiTheme.palette.text.secondary, minWidth: "2.5rem", textAlign: "right" },
  };
}
