use futures::TryStreamExt;
use mongodb::{
    Client, Collection, Database,
    IndexModel,
    options::{ClientOptions, IndexOptions, Tls, TlsOptions},
};
use serde_json::Value;
use std::path::PathBuf;

use crate::config::Config;
use crate::errors::AppError;

#[derive(Clone)]
pub struct DbClient {
    client: Client,
    pub default_db: String,
    pub uri: String,
    // TLS overrides (stored so reconnect can reapply them)
    pub tls_ca_file: Option<String>,
    pub tls_cert_key_file: Option<String>,
    pub tls_allow_invalid_certs: bool,
}

impl DbClient {
    /// Connect with explicit TLS override fields (mirrors the env-var config path).
    pub async fn from_uri_with_tls(
        uri: &str,
        default_db: &str,
        tls_ca_file: Option<String>,
        tls_cert_key_file: Option<String>,
        tls_allow_invalid_certs: bool,
    ) -> Result<Self, AppError> {
        let mut options = ClientOptions::parse(uri).await?;

        let needs_tls_override = tls_ca_file.is_some()
            || tls_cert_key_file.is_some()
            || tls_allow_invalid_certs;

        if needs_tls_override {
            let mut tls_opts = match options.tls.take() {
                Some(Tls::Enabled(existing)) => existing,
                _ => TlsOptions::default(),
            };
            if let Some(ca) = &tls_ca_file {
                tls_opts.ca_file_path = Some(PathBuf::from(ca));
            }
            if let Some(cert_key) = &tls_cert_key_file {
                tls_opts.cert_key_file_path = Some(PathBuf::from(cert_key));
            }
            if tls_allow_invalid_certs {
                tls_opts.allow_invalid_certificates = Some(true);
            }
            options.tls = Some(Tls::Enabled(tls_opts));
        }

        let client = Client::with_options(options)?;
        client
            .database("admin")
            .run_command(bson::doc! { "ping": 1 })
            .await?;
        tracing::info!("Connected to MongoDB at {}", uri);
        Ok(Self {
            client,
            default_db: default_db.to_string(),
            uri: uri.to_string(),
            tls_ca_file,
            tls_cert_key_file,
            tls_allow_invalid_certs,
        })
    }

    /// Convenience constructor: connect with no extra TLS overrides.
    pub async fn from_uri(uri: &str, default_db: &str) -> Result<Self, AppError> {
        Self::from_uri_with_tls(uri, default_db, None, None, false).await
    }

    pub async fn new(config: &Config) -> Result<Self, AppError> {
        Self::from_uri_with_tls(
            &config.mongodb_uri,
            &config.mongodb_db,
            config.mongodb_tls_ca_file.clone(),
            config.mongodb_tls_cert_key_file.clone(),
            config.mongodb_tls_allow_invalid_certs,
        )
        .await
    }

    /// Returns the URI with any password replaced by `***`.
    /// e.g. `mongodb://user:pass@host:27017` → `mongodb://user:***@host:27017`
    pub fn masked_uri(&self) -> String {
        if let Some(proto_end) = self.uri.find("://") {
            let after_proto = &self.uri[proto_end + 3..];
            if let Some(at_pos) = after_proto.find('@') {
                let user_info = &after_proto[..at_pos];
                if let Some(colon_pos) = user_info.find(':') {
                    let proto = &self.uri[..proto_end + 3];
                    let user = &user_info[..colon_pos];
                    let rest = &self.uri[proto_end + 3 + at_pos..];
                    return format!("{}{}:***{}", proto, user, rest);
                }
            }
        }
        self.uri.clone()
    }

    pub fn database(&self, name: &str) -> Database {
        self.client.database(name)
    }

    pub fn default_database(&self) -> Database {
        self.client.database(&self.default_db)
    }

    pub fn collection<T: Send + Sync>(&self, db: &str, collection: &str) -> Collection<T> {
        self.client.database(db).collection(collection)
    }

    pub async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let names = self.client.list_database_names().await?;
        Ok(names)
    }

    pub async fn list_collections(&self, db: &str) -> Result<Vec<String>, AppError> {
        let names = self.client.database(db).list_collection_names().await?;
        Ok(names)
    }

    pub async fn create_collection(&self, db: &str, collection: &str) -> Result<(), AppError> {
        self.client.database(db).create_collection(collection).await?;
        Ok(())
    }

    pub async fn drop_database(&self, db: &str) -> Result<(), AppError> {
        self.client.database(db).drop().await?;
        Ok(())
    }

    pub async fn drop_collection(&self, db: &str, collection: &str) -> Result<(), AppError> {
        self.client.database(db).collection::<bson::Document>(collection).drop().await?;
        Ok(())
    }

    pub async fn list_indexes(&self, db: &str, collection: &str) -> Result<Vec<Value>, AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        let mut cursor = coll.list_indexes().await?;
        let mut result = Vec::new();
        while let Some(model) = cursor.try_next().await? {
            let mut map = serde_json::Map::new();
            map.insert("keys".to_string(), serde_json::to_value(&model.keys)?);
            let name = model.options.as_ref()
                .and_then(|o| o.name.clone())
                .unwrap_or_else(|| "_unknown".to_string());
            map.insert("name".to_string(), Value::String(name));
            if let Some(opts) = &model.options {
                map.insert("unique".to_string(), Value::Bool(opts.unique.unwrap_or(false)));
                map.insert("sparse".to_string(), Value::Bool(opts.sparse.unwrap_or(false)));
                if let Some(expire) = opts.expire_after {
                    map.insert("ttl".to_string(), serde_json::json!(expire.as_secs()));
                }
            }
            result.push(Value::Object(map));
        }
        Ok(result)
    }

    pub async fn create_index(
        &self,
        db: &str,
        collection: &str,
        keys: bson::Document,
        name: Option<String>,
        unique: Option<bool>,
        sparse: Option<bool>,
        ttl: Option<u64>,
        background: Option<bool>,
    ) -> Result<String, AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        let mut opts = IndexOptions::default();
        opts.name = name;
        opts.unique = unique;
        opts.sparse = sparse;
        opts.expire_after = ttl.map(std::time::Duration::from_secs);
        opts.background = background;
        let model = IndexModel::builder()
            .keys(keys)
            .options(opts)
            .build();
        let res = coll.create_index(model).await?;
        Ok(res.index_name)
    }

    pub async fn drop_index(&self, db: &str, collection: &str, name: &str) -> Result<(), AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        coll.drop_index(name).await?;
        Ok(())
    }

    pub async fn run_command(&self, db_name: &str, command: bson::Document, admin: bool) -> Result<Value, AppError> {
        let db = if admin { self.client.database("admin") } else { self.client.database(db_name) };
        let result = db.run_command(command).await?;
        Ok(serde_json::to_value(result)?)
    }
}
