use futures::TryStreamExt;
use mongodb::{
    Client, Collection, Database,
    IndexModel,
    options::{ClientOptions, IndexOptions},
};
use serde_json::Value;

use crate::config::Config;
use crate::errors::AppError;

#[derive(Clone)]
pub struct DbClient {
    client: Client,
    pub default_db: String,
}

impl DbClient {
    pub async fn new(config: &Config) -> Result<Self, AppError> {
        let options = ClientOptions::parse(&config.mongodb_uri).await?;
        let client = Client::with_options(options)?;
        // Ping to verify connection
        client
            .database("admin")
            .run_command(bson::doc! { "ping": 1 }, None)
            .await?;
        tracing::info!("Connected to MongoDB at {}", config.mongodb_uri);
        Ok(Self {
            client,
            default_db: config.mongodb_db.clone(),
        })
    }

    pub fn database(&self, name: &str) -> Database {
        self.client.database(name)
    }

    pub fn default_database(&self) -> Database {
        self.client.database(&self.default_db)
    }

    pub fn collection<T>(&self, db: &str, collection: &str) -> Collection<T> {
        self.client.database(db).collection(collection)
    }

    pub async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let names = self.client.list_database_names(None, None).await?;
        Ok(names)
    }

    pub async fn list_collections(&self, db: &str) -> Result<Vec<String>, AppError> {
        let names = self.client.database(db).list_collection_names(None).await?;
        Ok(names)
    }

    pub async fn create_collection(&self, db: &str, collection: &str) -> Result<(), AppError> {
        self.client.database(db).create_collection(collection, None).await?;
        Ok(())
    }

    pub async fn drop_database(&self, db: &str) -> Result<(), AppError> {
        self.client.database(db).drop(None).await?;
        Ok(())
    }

    pub async fn drop_collection(&self, db: &str, collection: &str) -> Result<(), AppError> {
        self.client.database(db).collection::<bson::Document>(collection).drop(None).await?;
        Ok(())
    }

    pub async fn list_indexes(&self, db: &str, collection: &str) -> Result<Vec<Value>, AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        let mut cursor = coll.list_indexes(None).await?;
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
    ) -> Result<String, AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        let mut opts = IndexOptions::default();
        opts.name = name;
        opts.unique = unique;
        opts.sparse = sparse;
        opts.expire_after = ttl.map(std::time::Duration::from_secs);
        let model = IndexModel::builder()
            .keys(keys)
            .options(opts)
            .build();
        let res = coll.create_index(model, None).await?;
        Ok(res.index_name)
    }

    pub async fn drop_index(&self, db: &str, collection: &str, name: &str) -> Result<(), AppError> {
        let coll: Collection<bson::Document> = self.client.database(db).collection(collection);
        coll.drop_index(name, None).await?;
        Ok(())
    }
}
