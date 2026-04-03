use mongodb::{Client, Collection, Database, options::ClientOptions};

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
}
