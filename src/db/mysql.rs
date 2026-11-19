//! MySQL data source (read-only browsing).

use serde_json::{Map, Value, json};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, Row, TypeInfo};
use std::str::FromStr;
use std::time::Duration;

use crate::config::Config;
use crate::db::util::{mask_uri_password, sort_names};
use crate::errors::AppError;

/// Hard ceiling on rows returned by a single ad-hoc query, so that a
/// `SELECT` without `LIMIT` cannot exhaust memory.
pub const MAX_QUERY_ROWS: usize = 1_000;

/// MySQL identifiers are at most 64 characters.
const MAX_IDENT_LEN: usize = 64;

/// Quote an identifier for safe interpolation into SQL.
///
/// Schema and table names arrive from request path parameters, so they can
/// never be sent as bind parameters. Backticks and NUL bytes are rejected
/// outright rather than escaped, which makes injection through an identifier
/// impossible.
pub fn quote_ident(ident: &str) -> Result<String, AppError> {
    if ident.is_empty()
        || ident.len() > MAX_IDENT_LEN
        || ident.contains('`')
        || ident.contains('\0')
    {
        return Err(AppError::BadRequest(format!(
            "Invalid SQL identifier: '{ident}'"
        )));
    }
    Ok(format!("`{ident}`"))
}

/// Statements that only read data.
const READ_ONLY_PREFIXES: &[&str] = &["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"];

/// Reject anything that is not a single read-only statement.
///
/// MySQL cannot perform writes inside a `SELECT`/`WITH` statement, so checking
/// the leading keyword plus forbidding multiple statements and `INTO
/// OUTFILE`/`DUMPFILE` is sufficient to keep this endpoint read-only. Granting
/// dbv a read-only MySQL user remains the recommended defence in depth.
pub fn validate_read_only(sql: &str) -> Result<(), AppError> {
    let stripped = strip_sql_comments(sql);
    let trimmed = stripped.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Query is empty".into()));
    }

    // Reject anything after a statement separator (multi-statement injection).
    if let Some(pos) = trimmed.find(';')
        && !trimmed[pos + 1..].trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "Only a single statement may be executed".into(),
        ));
    }

    let upper = trimmed.to_uppercase();
    let first_word: String = upper
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if !READ_ONLY_PREFIXES.contains(&first_word.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Only read-only statements are allowed ({}), got '{}'",
            READ_ONLY_PREFIXES.join(", "),
            if first_word.is_empty() {
                trimmed.chars().take(16).collect::<String>()
            } else {
                first_word
            }
        )));
    }

    if upper.contains("INTO OUTFILE") || upper.contains("INTO DUMPFILE") {
        return Err(AppError::BadRequest(
            "Writing query results to files is not allowed".into(),
        ));
    }

    Ok(())
}

/// Remove `--`/`#` line comments and `/* */` block comments so that the
/// leading-keyword check cannot be bypassed by a comment prefix.
fn strip_sql_comments(sql: &str) -> String {
    let bytes: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let next = bytes.get(i + 1).copied();
        match (c, next) {
            ('-', Some('-')) | ('#', _) => {
                while i < bytes.len() && bytes[i] != '\n' {
                    i += 1;
                }
                out.push('\n');
            }
            ('/', Some('*')) => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == '*' && bytes[i + 1] == '/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                out.push(' ');
            }
            ('\'', _) | ('"', _) | ('`', _) => {
                // Copy quoted literals verbatim so comment markers inside them
                // are not treated as comments.
                let quote = c;
                out.push(c);
                i += 1;
                while i < bytes.len() {
                    out.push(bytes[i]);
                    if bytes[i] == '\\' && i + 1 < bytes.len() {
                        i += 1;
                        out.push(bytes[i]);
                    } else if bytes[i] == quote {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// Build an `ORDER BY` clause from the query bar's `{"column": 1 | -1}` JSON.
pub fn build_order_by(sort: Option<&Value>, columns: &[String]) -> Result<String, AppError> {
    let Some(Value::Object(map)) = sort else {
        return Ok(String::new());
    };
    let mut parts = Vec::new();
    for (key, direction) in map {
        if !columns.iter().any(|c| c == key) {
            return Err(AppError::BadRequest(format!("Unknown sort column '{key}'")));
        }
        let descending = matches!(direction, Value::Number(n) if n.as_i64() == Some(-1));
        parts.push(format!(
            "{} {}",
            quote_ident(key)?,
            if descending { "DESC" } else { "ASC" }
        ));
    }
    if parts.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(" ORDER BY {}", parts.join(", ")))
}

/// Build the select list from the query bar's `{"column": 1}` projection JSON.
/// Zero-valued keys exclude columns, mirroring MongoDB projection semantics.
pub fn build_select_list(
    projection: Option<&Value>,
    columns: &[String],
) -> Result<String, AppError> {
    let Some(Value::Object(map)) = projection else {
        return Ok("*".to_string());
    };
    if map.is_empty() {
        return Ok("*".to_string());
    }

    let including = map
        .values()
        .any(|v| matches!(v, Value::Number(n) if n.as_i64() == Some(1)));

    let chosen: Vec<&String> = if including {
        columns
            .iter()
            .filter(
                |c| matches!(map.get(c.as_str()), Some(Value::Number(n)) if n.as_i64() == Some(1)),
            )
            .collect()
    } else {
        columns
            .iter()
            .filter(|c| !map.contains_key(c.as_str()))
            .collect()
    };

    if chosen.is_empty() {
        return Ok("*".to_string());
    }

    let quoted: Vec<String> = chosen
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Result<_, _>>()?;
    Ok(quoted.join(", "))
}

/// An equality filter parsed from the query bar's JSON filter.
#[derive(Debug, Clone, PartialEq)]
pub struct EqFilter {
    pub column: String,
    pub value: Value,
}

/// Translate a flat `{"column": value}` JSON filter into equality predicates.
///
/// Only equality (and `null` checks) are supported in read-only mode; anything
/// else is rejected so the user gets a clear message instead of silently
/// unfiltered rows.
pub fn parse_filter(filter: Option<&Value>, columns: &[String]) -> Result<Vec<EqFilter>, AppError> {
    let Some(Value::Object(map)) = filter else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (key, value) in map {
        if key.starts_with('$') {
            return Err(AppError::BadRequest(format!(
                "Operator '{key}' is not supported for MySQL; use the SQL tab instead"
            )));
        }
        if !columns.iter().any(|c| c == key) {
            return Err(AppError::BadRequest(format!(
                "Unknown filter column '{key}'"
            )));
        }
        match value {
            Value::Object(_) | Value::Array(_) => {
                return Err(AppError::BadRequest(format!(
                    "Only equality filters are supported for MySQL (column '{key}'); use the SQL tab instead"
                )));
            }
            _ => out.push(EqFilter {
                column: key.clone(),
                value: value.clone(),
            }),
        }
    }
    Ok(out)
}

fn where_clause(filters: &[EqFilter]) -> Result<String, AppError> {
    if filters.is_empty() {
        return Ok(String::new());
    }
    let mut parts = Vec::new();
    for f in filters {
        let ident = quote_ident(&f.column)?;
        if f.value.is_null() {
            parts.push(format!("{ident} IS NULL"));
        } else {
            parts.push(format!("{ident} = ?"));
        }
    }
    Ok(format!(" WHERE {}", parts.join(" AND ")))
}

/// Bind a JSON scalar as a MySQL parameter.
fn bind_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    value: &Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match value {
        Value::Bool(b) => query.bind(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else {
                query.bind(n.as_f64().unwrap_or_default())
            }
        }
        Value::String(s) => query.bind(s.clone()),
        _ => query.bind(Option::<String>::None),
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        s.push_str(&format!("{b:02X}"));
    }
    s
}

/// Convert one column of a result row into JSON, preserving the value's
/// natural representation where possible.
fn column_to_json(row: &MySqlRow, idx: usize) -> Value {
    let type_name = row.column(idx).type_info().name().to_uppercase();

    macro_rules! try_decode {
        ($ty:ty) => {
            if let Ok(v) = row.try_get::<Option<$ty>, _>(idx) {
                return match v {
                    Some(v) => json!(v),
                    None => Value::Null,
                };
            }
        };
    }

    match type_name.as_str() {
        "NULL" => return Value::Null,
        "BOOLEAN" | "BOOL" => try_decode!(bool),
        "JSON" => try_decode!(Value),
        "FLOAT" | "DOUBLE" => try_decode!(f64),
        "DATE" => {
            if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(idx) {
                return v.map_or(Value::Null, |d| json!(d.to_string()));
            }
        }
        "TIME" => {
            if let Ok(v) = row.try_get::<Option<chrono::NaiveTime>, _>(idx) {
                return v.map_or(Value::Null, |d| json!(d.to_string()));
            }
        }
        "DATETIME" => {
            if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(idx) {
                return v.map_or(Value::Null, |d| json!(d.and_utc().to_rfc3339()));
            }
        }
        "TIMESTAMP" => {
            if let Ok(v) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(idx) {
                return v.map_or(Value::Null, |d| json!(d.to_rfc3339()));
            }
        }
        "BINARY" | "VARBINARY" | "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT"
        | "GEOMETRY" => {
            if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                return match v {
                    Some(bytes) => match String::from_utf8(bytes.clone()) {
                        Ok(s) => json!(s),
                        Err(_) => json!(hex_encode(&bytes)),
                    },
                    None => Value::Null,
                };
            }
        }
        name if name.contains("UNSIGNED") => try_decode!(u64),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT" => try_decode!(i64),
        _ => {}
    }

    // Textual types, DECIMAL, ENUM/SET, YEAR and anything unrecognised.
    try_decode!(String);

    // DECIMAL and other types sqlx has no native Rust mapping for still arrive
    // as text on the wire, so decode them unchecked rather than losing the value.
    if let Ok(v) = row.try_get_unchecked::<Option<String>, _>(idx) {
        return v.map_or(Value::Null, |s| json!(s));
    }
    if let Ok(v) = row.try_get_unchecked::<Option<Vec<u8>>, _>(idx) {
        return v.map_or(Value::Null, |b| match String::from_utf8(b.clone()) {
            Ok(s) => json!(s),
            Err(_) => json!(hex_encode(&b)),
        });
    }
    Value::Null
}

fn row_to_json(row: &MySqlRow) -> Value {
    let mut map = Map::new();
    for (idx, col) in row.columns().iter().enumerate() {
        map.insert(col.name().to_string(), column_to_json(row, idx));
    }
    Value::Object(map)
}

/// Map a MySQL `information_schema` data type onto the BSON-ish type names the
/// frontend schema viewer already understands.
pub fn mysql_type_to_label(data_type: &str) -> &'static str {
    match data_type.to_lowercase().as_str() {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "year" => "int",
        "bigint" => "long",
        "float" | "double" | "real" => "double",
        "decimal" | "numeric" => "decimal",
        "bit" | "bool" | "boolean" => "bool",
        "date" | "datetime" | "timestamp" => "date",
        "time" => "string",
        "json" => "object",
        "binary" | "varbinary" | "blob" | "tinyblob" | "mediumblob" | "longblob" => "binData",
        _ => "string",
    }
}

/// Extract the default schema from the path component of a MySQL URI.
fn schema_from_uri(uri: &str) -> Option<String> {
    let after_scheme = uri.split("://").nth(1)?;
    let path = after_scheme.split('/').nth(1)?;
    let schema = path.split('?').next().unwrap_or("");
    if schema.is_empty() {
        None
    } else {
        Some(schema.to_string())
    }
}

/// A page of rows plus the column order needed to render them as a table.
/// Query-bar inputs for [`MySqlClient::list_rows`].
pub struct ListRowsParams<'a> {
    pub filter: Option<&'a Value>,
    pub sort: Option<&'a Value>,
    pub projection: Option<&'a Value>,
    pub limit: i64,
    pub offset: i64,
}

pub struct RowPage {
    pub total: i64,
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
}

/// Result of an ad-hoc read-only query.
#[derive(Debug)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub truncated: bool,
}

#[derive(Clone)]
pub struct MySqlClient {
    pool: sqlx::MySqlPool,
    pub default_db: String,
    pub uri: String,
    pub tls_ca_file: Option<String>,
    pub tls_allow_invalid_certs: bool,
}

impl MySqlClient {
    pub async fn from_uri_with_tls(
        uri: &str,
        default_db: Option<&str>,
        tls_ca_file: Option<String>,
        tls_allow_invalid_certs: bool,
    ) -> Result<Self, AppError> {
        let mut options = MySqlConnectOptions::from_str(uri)
            .map_err(|e| AppError::BadRequest(format!("Invalid MySQL URI: {e}")))?;

        if let Some(ca) = &tls_ca_file {
            options = options.ssl_mode(MySqlSslMode::VerifyCa).ssl_ca(ca.as_str());
        }
        if tls_allow_invalid_certs {
            options = options.ssl_mode(MySqlSslMode::Preferred);
        }

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect_with(options)
            .await?;

        sqlx::query("SELECT 1").execute(&pool).await?;

        let default_db = default_db
            .map(|d| d.to_string())
            .filter(|d| !d.is_empty())
            .or_else(|| schema_from_uri(uri))
            .unwrap_or_default();

        tracing::info!("Connected to MySQL at {}", mask_uri_password(uri));

        Ok(Self {
            pool,
            default_db,
            uri: uri.to_string(),
            tls_ca_file,
            tls_allow_invalid_certs,
        })
    }

    pub async fn new(config: &Config) -> Result<Self, AppError> {
        let uri = config
            .mysql_uri
            .as_deref()
            .ok_or_else(|| AppError::Internal("MYSQL_URI is not configured".into()))?;
        Self::from_uri_with_tls(
            uri,
            config.mysql_db.as_deref(),
            config.mysql_tls_ca_file.clone(),
            config.mysql_tls_allow_invalid_certs,
        )
        .await
    }

    pub fn masked_uri(&self) -> String {
        mask_uri_password(&self.uri)
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query("SELECT schema_name FROM information_schema.schemata")
            .fetch_all(&self.pool)
            .await?;
        let names = rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .collect();
        Ok(sort_names(names))
    }

    pub async fn list_tables(&self, db: &str) -> Result<Vec<String>, AppError> {
        let rows =
            sqlx::query("SELECT table_name FROM information_schema.tables WHERE table_schema = ?")
                .bind(db)
                .fetch_all(&self.pool)
                .await?;
        let names = rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .collect();
        Ok(sort_names(names))
    }

    /// Ordered column names for a table, used to validate filter/sort input.
    pub async fn column_names(&self, db: &str, table: &str) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query(
            "SELECT column_name FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
        )
        .bind(db)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        let names: Vec<String> = rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .collect();
        if names.is_empty() {
            return Err(AppError::NotFound(format!(
                "Table '{db}.{table}' not found"
            )));
        }
        Ok(names)
    }

    /// Primary key columns for a table, in key order.
    pub async fn primary_key(&self, db: &str, table: &str) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query(
            "SELECT column_name FROM information_schema.key_column_usage \
             WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY' \
             ORDER BY ordinal_position",
        )
        .bind(db)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>(0).ok())
            .collect())
    }

    /// Fetch one page of rows, honouring the query bar's filter/sort/projection.
    pub async fn list_rows(
        &self,
        db: &str,
        table: &str,
        params: &ListRowsParams<'_>,
    ) -> Result<RowPage, AppError> {
        let columns = self.column_names(db, table).await?;
        let qualified = format!("{}.{}", quote_ident(db)?, quote_ident(table)?);

        let filters = parse_filter(params.filter, &columns)?;
        let where_sql = where_clause(&filters)?;
        let order_sql = build_order_by(params.sort, &columns)?;
        let select_list = build_select_list(params.projection, &columns)?;

        let count_sql = format!("SELECT COUNT(*) FROM {qualified}{where_sql}");
        let mut count_query = sqlx::query(&count_sql);
        for f in &filters {
            if !f.value.is_null() {
                count_query = bind_value(count_query, &f.value);
            }
        }
        let total: i64 = count_query.fetch_one(&self.pool).await?.try_get(0)?;

        let limit = params.limit.clamp(1, MAX_QUERY_ROWS as i64);
        let offset = params.offset.max(0);
        let rows_sql =
            format!("SELECT {select_list} FROM {qualified}{where_sql}{order_sql} LIMIT ? OFFSET ?");
        let mut rows_query = sqlx::query(&rows_sql);
        for f in &filters {
            if !f.value.is_null() {
                rows_query = bind_value(rows_query, &f.value);
            }
        }
        let rows = rows_query
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        let returned_columns = rows
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_else(|| {
                if select_list == "*" {
                    columns.clone()
                } else {
                    select_list
                        .split(", ")
                        .map(|c| c.trim_matches('`').to_string())
                        .collect()
                }
            });

        Ok(RowPage {
            total,
            columns: returned_columns,
            rows: rows.iter().map(row_to_json).collect(),
        })
    }

    /// Fetch a single row by its primary key value.
    pub async fn get_row(&self, db: &str, table: &str, id: &str) -> Result<Value, AppError> {
        let pk = self.primary_key(db, table).await?;
        let key = pk.first().ok_or_else(|| {
            AppError::BadRequest(format!("Table '{db}.{table}' has no primary key"))
        })?;
        let sql = format!(
            "SELECT * FROM {}.{} WHERE {} = ? LIMIT 1",
            quote_ident(db)?,
            quote_ident(table)?,
            quote_ident(key)?
        );
        let row = sqlx::query(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Row {id} not found")))?;
        Ok(row_to_json(&row))
    }

    /// Describe a table from `information_schema`, shaped like the MongoDB
    /// schema endpoint so the frontend can render both with one component.
    pub async fn table_schema(&self, db: &str, table: &str) -> Result<Value, AppError> {
        let rows = sqlx::query(
            "SELECT column_name, data_type, column_type, is_nullable, column_key, \
                    column_default, extra \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
        )
        .bind(db)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        if rows.is_empty() {
            return Err(AppError::NotFound(format!(
                "Table '{db}.{table}' not found"
            )));
        }

        let total: i64 = sqlx::query(&format!(
            "SELECT COUNT(*) FROM {}.{}",
            quote_ident(db)?,
            quote_ident(table)?
        ))
        .fetch_one(&self.pool)
        .await?
        .try_get(0)?;

        let fields: Vec<Value> = rows
            .iter()
            .map(|r| {
                let name: String = r.try_get(0).unwrap_or_default();
                let data_type: String = r.try_get(1).unwrap_or_default();
                let column_type: String = r.try_get(2).unwrap_or_default();
                let nullable = r.try_get::<String, _>(3).unwrap_or_default() == "YES";
                let column_key: String = r.try_get(4).unwrap_or_default();
                let default = column_to_json(r, 5);
                let extra: String = r.try_get(6).unwrap_or_default();
                json!({
                    "path": name,
                    "types": [mysql_type_to_label(&data_type)],
                    "nullable": nullable,
                    "occurrences": total,
                    "coverage": 1.0,
                    "sqlType": column_type,
                    "primaryKey": column_key == "PRI",
                    "unique": column_key == "UNI",
                    "default": default,
                    "extra": extra,
                })
            })
            .collect();

        Ok(json!({
            "sampled_documents": total,
            "fields": fields,
        }))
    }

    pub async fn list_indexes(&self, db: &str, table: &str) -> Result<Vec<Value>, AppError> {
        let rows = sqlx::query(
            "SELECT index_name, column_name, non_unique, seq_in_index \
             FROM information_schema.statistics \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY index_name, seq_in_index",
        )
        .bind(db)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        let mut grouped: Vec<(String, bool, Map<String, Value>)> = Vec::new();
        for r in &rows {
            let index_name: String = r.try_get(0).unwrap_or_default();
            let column_name: String = r.try_get(1).unwrap_or_default();
            let non_unique: i64 = r.try_get(2).unwrap_or(1);
            match grouped.iter_mut().find(|(name, _, _)| *name == index_name) {
                Some((_, _, keys)) => {
                    keys.insert(column_name, json!(1));
                }
                None => {
                    let mut keys = Map::new();
                    keys.insert(column_name, json!(1));
                    grouped.push((index_name, non_unique == 0, keys));
                }
            }
        }

        Ok(grouped
            .into_iter()
            .map(|(name, unique, keys)| {
                json!({ "name": name, "unique": unique, "sparse": false, "keys": keys })
            })
            .collect())
    }

    pub async fn database_stats(&self, db: &str) -> Result<Value, AppError> {
        let row = sqlx::query(
            "SELECT COUNT(*), COALESCE(SUM(data_length), 0), COALESCE(SUM(index_length), 0), \
                    COALESCE(SUM(table_rows), 0) \
             FROM information_schema.tables WHERE table_schema = ?",
        )
        .bind(db)
        .fetch_one(&self.pool)
        .await?;

        let collections: i64 = row.try_get(0).unwrap_or(0);
        let data_size: i64 = row.try_get(1).unwrap_or(0);
        let index_size: i64 = row.try_get(2).unwrap_or(0);
        let objects: i64 = row.try_get(3).unwrap_or(0);

        Ok(json!({
            "db": db,
            "collections": collections,
            "objects": objects,
            "dataSize": data_size,
            "indexSize": index_size,
            "storageSize": data_size + index_size,
        }))
    }

    pub async fn table_stats(&self, db: &str, table: &str) -> Result<Value, AppError> {
        let row = sqlx::query(
            "SELECT COALESCE(data_length, 0), COALESCE(index_length, 0), \
                    COALESCE(avg_row_length, 0), engine, table_collation \
             FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        )
        .bind(db)
        .bind(table)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Table '{db}.{table}' not found")))?;

        let data_size: i64 = row.try_get(0).unwrap_or(0);
        let index_size: i64 = row.try_get(1).unwrap_or(0);
        let avg_row: i64 = row.try_get(2).unwrap_or(0);
        let engine: Option<String> = row.try_get(3).ok();
        let collation: Option<String> = row.try_get(4).ok();

        // information_schema.table_rows is only an estimate for InnoDB, so take
        // the exact count for a figure users can trust.
        let count: i64 = sqlx::query(&format!(
            "SELECT COUNT(*) FROM {}.{}",
            quote_ident(db)?,
            quote_ident(table)?
        ))
        .fetch_one(&self.pool)
        .await?
        .try_get(0)?;

        Ok(json!({
            "ns": format!("{db}.{table}"),
            "count": count,
            "size": data_size,
            "storageSize": data_size,
            "totalIndexSize": index_size,
            "avgObjSize": avg_row,
            "engine": engine,
            "collation": collation,
        }))
    }

    /// Run a single read-only statement, capped at [`MAX_QUERY_ROWS`] rows.
    pub async fn execute_select(&self, db: &str, sql: &str) -> Result<QueryResult, AppError> {
        validate_read_only(sql)?;

        let mut conn = self.pool.acquire().await?;
        if !db.is_empty() {
            let use_sql = format!("USE {}", quote_ident(db)?);
            sqlx::query(&use_sql).execute(&mut *conn).await?;
        }

        let rows = sqlx::query(sql)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        let truncated = rows.len() > MAX_QUERY_ROWS;
        let kept = if truncated {
            &rows[..MAX_QUERY_ROWS]
        } else {
            &rows[..]
        };

        let columns = kept
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();

        Ok(QueryResult {
            columns,
            rows: kept.iter().map(row_to_json).collect(),
            truncated,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── quote_ident ───────────────────────────────────────────────────────────

    #[test]
    fn quote_ident_wraps_in_backticks() {
        assert_eq!(quote_ident("users").unwrap(), "`users`");
    }

    #[test]
    fn quote_ident_allows_spaces_and_dots() {
        assert_eq!(quote_ident("my table.v2").unwrap(), "`my table.v2`");
    }

    #[test]
    fn quote_ident_rejects_backtick_injection() {
        let err = quote_ident("users`; DROP TABLE x; --").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn quote_ident_rejects_empty() {
        assert!(quote_ident("").is_err());
    }

    #[test]
    fn quote_ident_rejects_nul_byte() {
        assert!(quote_ident("users\0").is_err());
    }

    #[test]
    fn quote_ident_rejects_overlong_identifier() {
        assert!(quote_ident(&"a".repeat(65)).is_err());
    }

    // ── validate_read_only ────────────────────────────────────────────────────

    #[test]
    fn validate_read_only_accepts_select() {
        assert!(validate_read_only("SELECT * FROM users").is_ok());
    }

    #[test]
    fn validate_read_only_accepts_lowercase_and_leading_whitespace() {
        assert!(validate_read_only("\n  select 1 ").is_ok());
    }

    #[test]
    fn validate_read_only_accepts_with_show_describe_explain() {
        for sql in [
            "WITH t AS (SELECT 1) SELECT * FROM t",
            "SHOW TABLES",
            "DESCRIBE users",
            "DESC users",
            "EXPLAIN SELECT 1",
        ] {
            assert!(validate_read_only(sql).is_ok(), "rejected: {sql}");
        }
    }

    #[test]
    fn validate_read_only_accepts_trailing_semicolon() {
        assert!(validate_read_only("SELECT 1;").is_ok());
        assert!(validate_read_only("SELECT 1;  \n").is_ok());
    }

    #[test]
    fn validate_read_only_rejects_writes() {
        for sql in [
            "INSERT INTO users VALUES (1)",
            "UPDATE users SET a = 1",
            "DELETE FROM users",
            "DROP TABLE users",
            "TRUNCATE users",
            "ALTER TABLE users ADD c INT",
            "CREATE TABLE t (a INT)",
            "GRANT ALL ON *.* TO 'x'",
            "CALL some_proc()",
            "SET GLOBAL x = 1",
        ] {
            let err = validate_read_only(sql).unwrap_err();
            assert!(matches!(err, AppError::BadRequest(_)), "allowed: {sql}");
        }
    }

    #[test]
    fn validate_read_only_rejects_multiple_statements() {
        let err = validate_read_only("SELECT 1; DROP TABLE users").unwrap_err();
        assert!(err.to_string().contains("single statement"));
    }

    #[test]
    fn validate_read_only_rejects_comment_prefixed_write() {
        let err = validate_read_only("/* hi */ DELETE FROM users").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
        let err = validate_read_only("-- comment\nUPDATE users SET a=1").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn validate_read_only_rejects_into_outfile() {
        let err = validate_read_only("SELECT * FROM users INTO OUTFILE '/tmp/x'").unwrap_err();
        assert!(err.to_string().contains("files"));
    }

    #[test]
    fn validate_read_only_rejects_empty_query() {
        assert!(validate_read_only("   ").is_err());
        assert!(validate_read_only("-- only a comment").is_err());
    }

    #[test]
    fn validate_read_only_allows_write_keyword_inside_string_literal() {
        assert!(validate_read_only("SELECT * FROM logs WHERE msg = 'delete me'").is_ok());
    }

    // ── strip_sql_comments ────────────────────────────────────────────────────

    #[test]
    fn strip_sql_comments_preserves_string_literals() {
        let out = strip_sql_comments("SELECT '-- not a comment' FROM t");
        assert!(out.contains("-- not a comment"));
    }

    #[test]
    fn strip_sql_comments_removes_block_comment() {
        let out = strip_sql_comments("SELECT /* inner */ 1");
        assert!(!out.contains("inner"));
    }

    // ── build_order_by ────────────────────────────────────────────────────────

    #[test]
    fn build_order_by_renders_directions() {
        let cols = vec!["name".to_string(), "age".to_string()];
        let sort = json!({ "age": -1 });
        assert_eq!(
            build_order_by(Some(&sort), &cols).unwrap(),
            " ORDER BY `age` DESC"
        );
        let sort = json!({ "name": 1 });
        assert_eq!(
            build_order_by(Some(&sort), &cols).unwrap(),
            " ORDER BY `name` ASC"
        );
    }

    #[test]
    fn build_order_by_empty_when_absent() {
        let cols = vec!["name".to_string()];
        assert_eq!(build_order_by(None, &cols).unwrap(), "");
        assert_eq!(build_order_by(Some(&json!({})), &cols).unwrap(), "");
    }

    #[test]
    fn build_order_by_rejects_unknown_column() {
        let cols = vec!["name".to_string()];
        let sort = json!({ "nope": 1 });
        assert!(build_order_by(Some(&sort), &cols).is_err());
    }

    // ── build_select_list ─────────────────────────────────────────────────────

    #[test]
    fn build_select_list_defaults_to_star() {
        let cols = vec!["a".to_string(), "b".to_string()];
        assert_eq!(build_select_list(None, &cols).unwrap(), "*");
        assert_eq!(build_select_list(Some(&json!({})), &cols).unwrap(), "*");
    }

    #[test]
    fn build_select_list_includes_selected_columns_in_table_order() {
        let cols = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let proj = json!({ "c": 1, "a": 1 });
        assert_eq!(build_select_list(Some(&proj), &cols).unwrap(), "`a`, `c`");
    }

    #[test]
    fn build_select_list_excludes_zero_valued_columns() {
        let cols = vec!["a".to_string(), "b".to_string()];
        let proj = json!({ "b": 0 });
        assert_eq!(build_select_list(Some(&proj), &cols).unwrap(), "`a`");
    }

    #[test]
    fn build_select_list_ignores_unknown_columns() {
        let cols = vec!["a".to_string()];
        let proj = json!({ "zzz": 1 });
        // Nothing valid selected — fall back to all columns rather than invalid SQL.
        assert_eq!(build_select_list(Some(&proj), &cols).unwrap(), "*");
    }

    // ── parse_filter ──────────────────────────────────────────────────────────

    #[test]
    fn parse_filter_extracts_equality_predicates() {
        let cols = vec!["name".to_string(), "age".to_string()];
        let filter = json!({ "name": "Alice" });
        let parsed = parse_filter(Some(&filter), &cols).unwrap();
        assert_eq!(
            parsed,
            vec![EqFilter {
                column: "name".to_string(),
                value: json!("Alice")
            }]
        );
    }

    #[test]
    fn parse_filter_empty_for_none() {
        let cols = vec!["name".to_string()];
        assert!(parse_filter(None, &cols).unwrap().is_empty());
        assert!(parse_filter(Some(&json!({})), &cols).unwrap().is_empty());
    }

    #[test]
    fn parse_filter_rejects_mongo_operators() {
        let cols = vec!["age".to_string()];
        let filter = json!({ "$or": [] });
        let err = parse_filter(Some(&filter), &cols).unwrap_err();
        assert!(err.to_string().contains("not supported"));
    }

    #[test]
    fn parse_filter_rejects_operator_objects() {
        let cols = vec!["age".to_string()];
        let filter = json!({ "age": { "$gt": 5 } });
        let err = parse_filter(Some(&filter), &cols).unwrap_err();
        assert!(err.to_string().contains("equality"));
    }

    #[test]
    fn parse_filter_rejects_unknown_column() {
        let cols = vec!["age".to_string()];
        let filter = json!({ "nope": 1 });
        assert!(parse_filter(Some(&filter), &cols).is_err());
    }

    #[test]
    fn parse_filter_accepts_null_value() {
        let cols = vec!["deleted_at".to_string()];
        let filter = json!({ "deleted_at": null });
        let parsed = parse_filter(Some(&filter), &cols).unwrap();
        assert_eq!(parsed[0].value, Value::Null);
    }

    // ── where_clause ──────────────────────────────────────────────────────────

    #[test]
    fn where_clause_uses_placeholders() {
        let filters = vec![EqFilter {
            column: "name".to_string(),
            value: json!("Alice"),
        }];
        assert_eq!(where_clause(&filters).unwrap(), " WHERE `name` = ?");
    }

    #[test]
    fn where_clause_uses_is_null_for_null_values() {
        let filters = vec![EqFilter {
            column: "deleted_at".to_string(),
            value: Value::Null,
        }];
        assert_eq!(
            where_clause(&filters).unwrap(),
            " WHERE `deleted_at` IS NULL"
        );
    }

    #[test]
    fn where_clause_joins_with_and() {
        let filters = vec![
            EqFilter {
                column: "a".to_string(),
                value: json!(1),
            },
            EqFilter {
                column: "b".to_string(),
                value: json!(2),
            },
        ];
        assert_eq!(
            where_clause(&filters).unwrap(),
            " WHERE `a` = ? AND `b` = ?"
        );
    }

    #[test]
    fn where_clause_empty_for_no_filters() {
        assert_eq!(where_clause(&[]).unwrap(), "");
    }

    // ── type mapping ──────────────────────────────────────────────────────────

    #[test]
    fn mysql_type_to_label_maps_numeric_types() {
        assert_eq!(mysql_type_to_label("int"), "int");
        assert_eq!(mysql_type_to_label("BIGINT"), "long");
        assert_eq!(mysql_type_to_label("double"), "double");
        assert_eq!(mysql_type_to_label("decimal"), "decimal");
    }

    #[test]
    fn mysql_type_to_label_maps_temporal_and_text() {
        assert_eq!(mysql_type_to_label("datetime"), "date");
        assert_eq!(mysql_type_to_label("timestamp"), "date");
        assert_eq!(mysql_type_to_label("varchar"), "string");
        assert_eq!(mysql_type_to_label("json"), "object");
        assert_eq!(mysql_type_to_label("blob"), "binData");
        assert_eq!(mysql_type_to_label("tinyint"), "int");
        assert_eq!(mysql_type_to_label("unknown_type"), "string");
    }

    // ── schema_from_uri ───────────────────────────────────────────────────────

    #[test]
    fn schema_from_uri_extracts_database() {
        assert_eq!(
            schema_from_uri("mysql://localhost:3306/shop"),
            Some("shop".to_string())
        );
    }

    #[test]
    fn schema_from_uri_strips_query_params() {
        assert_eq!(
            schema_from_uri("mysql://localhost:3306/shop?ssl-mode=required"),
            Some("shop".to_string())
        );
    }

    #[test]
    fn schema_from_uri_none_when_absent() {
        assert_eq!(schema_from_uri("mysql://localhost:3306"), None);
        assert_eq!(schema_from_uri("mysql://localhost:3306/"), None);
    }

    // ── hex_encode ────────────────────────────────────────────────────────────

    #[test]
    fn hex_encode_formats_bytes() {
        assert_eq!(hex_encode(&[0x00, 0x1f, 0xff]), "0x001FFF");
    }
}

/// Integration tests that require a live MySQL/MariaDB server.
///
/// Run with:
/// ```text
/// DBV_TEST_MYSQL_URI=mysql://user:pass@127.0.0.1:3306/dbvtest \
///   cargo test --all-features mysql::live -- --ignored
/// ```
/// The target server must contain the `dbvtest` schema created by
/// `tests/fixtures/mysql_seed.sql`.
#[cfg(test)]
mod live {
    use super::*;

    const DB: &str = "dbvtest";
    const TABLE: &str = "widgets";

    async fn client() -> MySqlClient {
        let uri = std::env::var("DBV_TEST_MYSQL_URI").expect("DBV_TEST_MYSQL_URI must be set");
        MySqlClient::from_uri_with_tls(&uri, Some(DB), None, false)
            .await
            .expect("connect to test MySQL server")
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn ping_and_list_databases_and_tables() {
        let c = client().await;
        c.ping().await.unwrap();
        assert_eq!(c.default_db, DB);
        assert!(c.list_databases().await.unwrap().contains(&DB.to_string()));
        assert!(
            c.list_tables(DB)
                .await
                .unwrap()
                .contains(&TABLE.to_string())
        );
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn column_names_and_primary_key() {
        let c = client().await;
        let cols = c.column_names(DB, TABLE).await.unwrap();
        assert_eq!(cols.first().map(String::as_str), Some("id"));
        assert!(cols.contains(&"payload".to_string()));
        assert_eq!(c.primary_key(DB, TABLE).await.unwrap(), vec!["id"]);
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn list_rows_decodes_every_column_type() {
        let c = client().await;
        let page = c
            .list_rows(
                DB,
                TABLE,
                &ListRowsParams {
                    filter: None,
                    sort: None,
                    projection: None,
                    limit: 50,
                    offset: 0,
                },
            )
            .await
            .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.rows.len(), 3);
        assert!(page.columns.contains(&"blob_col".to_string()));

        let alpha = page
            .rows
            .iter()
            .find(|r| r["name"] == serde_json::json!("alpha"))
            .expect("alpha row");
        assert_eq!(alpha["id"], serde_json::json!(1));
        assert_eq!(alpha["price"], serde_json::json!("1.50"));
        assert_eq!(alpha["qty"], serde_json::json!(10));
        // BLOB values that are not valid UTF-8 render as hex.
        assert_eq!(alpha["blob_col"], serde_json::json!("0x00FF10"));
        assert!(alpha["created_at"].is_string());

        let beta = page
            .rows
            .iter()
            .find(|r| r["name"] == serde_json::json!("beta"))
            .expect("beta row");
        assert!(beta["qty"].is_null());
        assert!(beta["payload"].is_null());
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn list_rows_applies_filter_sort_projection_and_paging() {
        let c = client().await;
        let sort = serde_json::json!({ "name": -1 });
        let projection = serde_json::json!({ "name": 1 });
        let page = c
            .list_rows(
                DB,
                TABLE,
                &ListRowsParams {
                    filter: None,
                    sort: Some(&sort),
                    projection: Some(&projection),
                    limit: 2,
                    offset: 0,
                },
            )
            .await
            .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.columns, vec!["name".to_string()]);
        assert_eq!(page.rows.len(), 2);
        assert_eq!(page.rows[0]["name"], serde_json::json!("gamma"));
        assert!(page.rows[0].get("price").is_none());

        // Offset paging continues the same ordering.
        let page2 = c
            .list_rows(
                DB,
                TABLE,
                &ListRowsParams {
                    filter: None,
                    sort: Some(&sort),
                    projection: Some(&projection),
                    limit: 2,
                    offset: 2,
                },
            )
            .await
            .unwrap();
        assert_eq!(page2.rows.len(), 1);
        assert_eq!(page2.rows[0]["name"], serde_json::json!("alpha"));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn list_rows_filter_matches_values_and_nulls() {
        let c = client().await;
        let eq = serde_json::json!({ "name": "beta" });
        let page = c
            .list_rows(
                DB,
                TABLE,
                &ListRowsParams {
                    filter: Some(&eq),
                    sort: None,
                    projection: None,
                    limit: 10,
                    offset: 0,
                },
            )
            .await
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0]["name"], serde_json::json!("beta"));

        let is_null = serde_json::json!({ "qty": Value::Null });
        let page = c
            .list_rows(
                DB,
                TABLE,
                &ListRowsParams {
                    filter: Some(&is_null),
                    sort: None,
                    projection: None,
                    limit: 10,
                    offset: 0,
                },
            )
            .await
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0]["name"], serde_json::json!("beta"));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn get_row_by_primary_key() {
        let c = client().await;
        let row = c.get_row(DB, TABLE, "1").await.unwrap();
        assert_eq!(row["name"], serde_json::json!("alpha"));

        let err = c.get_row(DB, TABLE, "9999").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn table_schema_matches_mongo_contract() {
        let c = client().await;
        let schema = c.table_schema(DB, TABLE).await.unwrap();
        assert_eq!(schema["sampled_documents"], serde_json::json!(3));

        let fields = schema["fields"].as_array().unwrap();
        let id = fields.iter().find(|f| f["path"] == "id").unwrap();
        assert_eq!(id["types"], serde_json::json!(["int"]));
        assert_eq!(id["nullable"], serde_json::json!(false));
        assert_eq!(id["primaryKey"], serde_json::json!(true));
        assert_eq!(id["coverage"], serde_json::json!(1.0));

        let qty = fields.iter().find(|f| f["path"] == "qty").unwrap();
        assert_eq!(qty["nullable"], serde_json::json!(true));
        assert_eq!(qty["sqlType"], serde_json::json!("bigint(20)"));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn list_indexes_reports_primary_and_secondary_keys() {
        let c = client().await;
        let idx = c.list_indexes(DB, TABLE).await.unwrap();
        let primary = idx.iter().find(|i| i["name"] == "PRIMARY").unwrap();
        assert_eq!(primary["unique"], serde_json::json!(true));
        assert_eq!(primary["keys"], serde_json::json!({ "id": 1 }));

        let uq = idx.iter().find(|i| i["name"] == "uq_name").unwrap();
        assert_eq!(uq["unique"], serde_json::json!(true));

        let non_unique = idx.iter().find(|i| i["name"] == "idx_qty").unwrap();
        assert_eq!(non_unique["unique"], serde_json::json!(false));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn database_and_table_stats() {
        let c = client().await;
        let db_stats = c.database_stats(DB).await.unwrap();
        assert!(db_stats["collections"].as_i64().unwrap() >= 1);

        let table_stats = c.table_stats(DB, TABLE).await.unwrap();
        assert_eq!(table_stats["count"], serde_json::json!(3));
        assert_eq!(table_stats["ns"], serde_json::json!("dbvtest.widgets"));
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn execute_select_returns_rows_in_column_order() {
        let c = client().await;
        let r = c
            .execute_select(DB, "SELECT name, qty FROM widgets ORDER BY name")
            .await
            .unwrap();
        assert_eq!(r.columns, vec!["name".to_string(), "qty".to_string()]);
        assert_eq!(r.rows.len(), 3);
        assert_eq!(r.rows[0]["name"], serde_json::json!("alpha"));
        assert!(!r.truncated);
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn execute_select_allows_show_and_describe() {
        let c = client().await;
        assert!(
            !c.execute_select(DB, "SHOW TABLES")
                .await
                .unwrap()
                .rows
                .is_empty()
        );
        assert!(
            !c.execute_select(DB, "DESCRIBE widgets")
                .await
                .unwrap()
                .rows
                .is_empty()
        );
        assert!(
            !c.execute_select(DB, "EXPLAIN SELECT * FROM widgets")
                .await
                .unwrap()
                .rows
                .is_empty()
        );
    }

    #[tokio::test]
    #[ignore = "requires a live MySQL server; set DBV_TEST_MYSQL_URI"]
    async fn execute_select_rejects_writes_before_reaching_the_server() {
        let c = client().await;
        for sql in [
            "DELETE FROM widgets",
            "UPDATE widgets SET name = 'x'",
            "INSERT INTO widgets (name) VALUES ('x')",
            "DROP TABLE widgets",
            "SELECT 1; DROP TABLE widgets",
            "SELECT * FROM widgets INTO OUTFILE '/tmp/x'",
        ] {
            let err = c.execute_select(DB, sql).await.unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "expected {sql:?} to be rejected, got {err:?}"
            );
        }

        // The table is untouched.
        assert_eq!(
            c.table_stats(DB, TABLE).await.unwrap()["count"],
            serde_json::json!(3)
        );
    }
}
