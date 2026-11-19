use serde::Deserialize;

use crate::db::Engine;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default = "default_host")]
    pub server_host: String,

    #[serde(default = "default_port")]
    pub server_port: u16,

    /// Which database engine to connect to on startup: `mongodb` (default) or `mysql`.
    #[serde(default)]
    pub db_engine: Engine,

    /// Full MySQL connection string. Required when `DB_ENGINE=mysql`.
    pub mysql_uri: Option<String>,

    /// Default MySQL schema shown on startup. Falls back to the schema
    /// embedded in `MYSQL_URI` when unset.
    pub mysql_db: Option<String>,

    /// Path to a PEM-encoded CA certificate used to verify the MySQL server.
    pub mysql_tls_ca_file: Option<String>,

    /// Set to "true" to skip MySQL server certificate validation (dev only).
    #[serde(default)]
    pub mysql_tls_allow_invalid_certs: bool,

    /// Full MongoDB connection string.
    /// Standalone:   mongodb://localhost:27017
    /// With auth:    mongodb://user:pass@host:27017/?authSource=admin
    /// Replica set:  mongodb://h1,h2,h3/?replicaSet=myRS
    /// Atlas/SRV:    mongodb+srv://user:pass@cluster.mongodb.net/
    /// With TLS:     mongodb://host:27017/?tls=true
    pub mongodb_uri: Option<String>,

    /// Default database shown on startup.
    pub mongodb_db: Option<String>,

    /// Path to a PEM-encoded CA certificate file.
    /// Required when MongoDB uses a self-signed or private-CA TLS certificate.
    pub mongodb_tls_ca_file: Option<String>,

    /// Path to a PEM file containing the client certificate AND private key
    /// for mutual TLS (x.509 client authentication).
    pub mongodb_tls_cert_key_file: Option<String>,

    /// Set to "true" to skip server certificate validation.
    /// Useful for local dev with self-signed certs; never use in production.
    #[serde(default)]
    pub mongodb_tls_allow_invalid_certs: bool,

    pub keycloak_url: String,
    pub keycloak_realm: String,
    pub keycloak_client_id: String,

    #[serde(default = "default_frontend_dist")]
    pub frontend_dist: String,
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_frontend_dist() -> String {
    "./frontend/dist".to_string()
}

impl Config {
    pub fn from_env() -> Result<Self, envy::Error> {
        let config = envy::from_env::<Config>()?;
        config.validate().map_err(envy::Error::Custom)?;
        Ok(config)
    }

    /// Fail fast when the variables required by the selected engine are absent.
    fn validate(&self) -> Result<(), String> {
        match self.db_engine {
            Engine::Mongo => {
                if self.mongodb_uri.as_deref().unwrap_or("").is_empty() {
                    return Err("MONGODB_URI is required when DB_ENGINE=mongodb".to_string());
                }
                if self.mongodb_db.as_deref().unwrap_or("").is_empty() {
                    return Err("MONGODB_DB is required when DB_ENGINE=mongodb".to_string());
                }
            }
            Engine::MySql => {
                if self.mysql_uri.as_deref().unwrap_or("").is_empty() {
                    return Err("MYSQL_URI is required when DB_ENGINE=mysql".to_string());
                }
            }
        }
        Ok(())
    }

    pub fn jwks_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/certs",
            self.keycloak_url, self.keycloak_realm
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(url: &str, realm: &str) -> Config {
        Config {
            server_host: "0.0.0.0".to_string(),
            server_port: 8080,
            db_engine: Engine::Mongo,
            mysql_uri: None,
            mysql_db: None,
            mysql_tls_ca_file: None,
            mysql_tls_allow_invalid_certs: false,
            mongodb_uri: Some("mongodb://localhost:27017".to_string()),
            mongodb_db: Some("testdb".to_string()),
            mongodb_tls_ca_file: None,
            mongodb_tls_cert_key_file: None,
            mongodb_tls_allow_invalid_certs: false,
            keycloak_url: url.to_string(),
            keycloak_realm: realm.to_string(),
            keycloak_client_id: "dbv".to_string(),
            frontend_dist: "./frontend/dist".to_string(),
        }
    }

    #[test]
    fn jwks_url_builds_correct_path() {
        let cfg = make_config("http://keycloak:8080", "myrealm");
        assert_eq!(
            cfg.jwks_url(),
            "http://keycloak:8080/realms/myrealm/protocol/openid-connect/certs"
        );
    }

    #[test]
    fn jwks_url_handles_trailing_slash() {
        let cfg = make_config("http://keycloak:8080/", "myrealm");
        // The URL is built by string concat; trailing slash is preserved
        assert!(
            cfg.jwks_url()
                .contains("/realms/myrealm/protocol/openid-connect/certs")
        );
    }

    #[test]
    fn default_server_host_is_0_0_0_0() {
        assert_eq!(super::default_host(), "0.0.0.0");
    }

    #[test]
    fn default_server_port_is_8080() {
        assert_eq!(super::default_port(), 8080);
    }

    #[test]
    fn default_frontend_dist_is_correct() {
        assert_eq!(super::default_frontend_dist(), "./frontend/dist");
    }

    #[test]
    fn default_engine_is_mongo() {
        assert_eq!(Engine::default(), Engine::Mongo);
    }

    #[test]
    fn validate_accepts_mongo_config() {
        let cfg = make_config("http://keycloak:8080", "realm");
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_mongo_engine_without_uri() {
        let mut cfg = make_config("http://keycloak:8080", "realm");
        cfg.mongodb_uri = None;
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("MONGODB_URI"));
    }

    #[test]
    fn validate_rejects_mongo_engine_without_db() {
        let mut cfg = make_config("http://keycloak:8080", "realm");
        cfg.mongodb_db = None;
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("MONGODB_DB"));
    }

    #[test]
    fn validate_rejects_mysql_engine_without_uri() {
        let mut cfg = make_config("http://keycloak:8080", "realm");
        cfg.db_engine = Engine::MySql;
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("MYSQL_URI"));
    }

    #[test]
    fn validate_accepts_mysql_engine_without_mongo_vars() {
        let mut cfg = make_config("http://keycloak:8080", "realm");
        cfg.db_engine = Engine::MySql;
        cfg.mongodb_uri = None;
        cfg.mongodb_db = None;
        cfg.mysql_uri = Some("mysql://localhost:3306/app".to_string());
        assert!(cfg.validate().is_ok());
    }
}
