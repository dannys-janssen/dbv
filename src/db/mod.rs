//! Data source layer.
//!
//! dbv keeps a single active connection. [`DataSource`] holds whichever engine
//! that connection currently targets, so handlers written against MongoDB keep
//! working unchanged while MySQL-capable handlers dispatch on the variant.

pub mod mongo;
pub mod mysql;
mod util;

use serde::{Deserialize, Serialize};

pub use mongo::{CreateIndexParams, DbClient};
pub use mysql::{ListRowsParams, MySqlClient};

use crate::errors::AppError;

/// Database engines dbv can connect to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    #[default]
    #[serde(rename = "mongodb", alias = "mongo")]
    Mongo,
    #[serde(rename = "mysql", alias = "mariadb")]
    MySql,
}

impl Engine {
    /// Human-readable engine name used in error messages.
    fn label(&self) -> &'static str {
        match self {
            Engine::Mongo => "MongoDB",
            Engine::MySql => "MySQL",
        }
    }
}

/// The active connection.
#[allow(clippy::large_enum_variant)]
pub enum DataSource {
    Mongo(DbClient),
    MySql(MySqlClient),
}

impl DataSource {
    pub fn engine(&self) -> Engine {
        match self {
            DataSource::Mongo(_) => Engine::Mongo,
            DataSource::MySql(_) => Engine::MySql,
        }
    }

    /// The MongoDB client, or a 501 explaining that the active engine differs.
    pub fn as_mongo(&self) -> Result<&DbClient, AppError> {
        match self {
            DataSource::Mongo(client) => Ok(client),
            other => Err(AppError::Unsupported(format!(
                "This operation requires MongoDB; the active connection is {}",
                other.engine().label()
            ))),
        }
    }

    /// The MySQL client, or a 501 explaining that the active engine differs.
    pub fn as_mysql(&self) -> Result<&MySqlClient, AppError> {
        match self {
            DataSource::MySql(client) => Ok(client),
            other => Err(AppError::Unsupported(format!(
                "This operation requires MySQL; the active connection is {}",
                other.engine().label()
            ))),
        }
    }

    /// Connection URI with the password masked.
    pub fn masked_uri(&self) -> String {
        match self {
            DataSource::Mongo(c) => c.masked_uri(),
            DataSource::MySql(c) => c.masked_uri(),
        }
    }

    /// Check the connection is alive.
    pub async fn ping(&self) -> Result<(), AppError> {
        match self {
            DataSource::Mongo(c) => c
                .run_command("admin", bson::doc! { "ping": 1 }, true)
                .await
                .map(|_| ()),
            DataSource::MySql(c) => c.ping().await,
        }
    }

    /// Databases (MongoDB) or schemas (MySQL), sorted case-insensitively.
    pub async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        match self {
            DataSource::Mongo(c) => c.list_databases().await,
            DataSource::MySql(c) => c.list_databases().await,
        }
    }

    /// Collections (MongoDB) or tables (MySQL), sorted case-insensitively.
    pub async fn list_collections(&self, db: &str) -> Result<Vec<String>, AppError> {
        match self {
            DataSource::Mongo(c) => c.list_collections(db).await,
            DataSource::MySql(c) => c.list_tables(db).await,
        }
    }

    /// Indexes of a collection/table.
    pub async fn list_indexes(
        &self,
        db: &str,
        collection: &str,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        match self {
            DataSource::Mongo(c) => c.list_indexes(db, collection).await,
            DataSource::MySql(c) => c.list_indexes(db, collection).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_deserializes_from_env_strings() {
        assert_eq!(
            serde_json::from_str::<Engine>("\"mongodb\"").unwrap(),
            Engine::Mongo
        );
        assert_eq!(
            serde_json::from_str::<Engine>("\"mongo\"").unwrap(),
            Engine::Mongo
        );
        assert_eq!(
            serde_json::from_str::<Engine>("\"mysql\"").unwrap(),
            Engine::MySql
        );
        assert_eq!(
            serde_json::from_str::<Engine>("\"mariadb\"").unwrap(),
            Engine::MySql
        );
    }

    #[test]
    fn engine_rejects_unknown_value() {
        assert!(serde_json::from_str::<Engine>("\"postgres\"").is_err());
    }

    #[test]
    fn engine_serializes_to_lowercase_name() {
        assert_eq!(
            serde_json::to_string(&Engine::Mongo).unwrap(),
            "\"mongodb\""
        );
        assert_eq!(serde_json::to_string(&Engine::MySql).unwrap(), "\"mysql\"");
    }

    #[test]
    fn engine_default_is_mongo() {
        assert_eq!(Engine::default(), Engine::Mongo);
    }
}
