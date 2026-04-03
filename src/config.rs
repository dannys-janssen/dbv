use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default = "default_host")]
    pub server_host: String,

    #[serde(default = "default_port")]
    pub server_port: u16,

    /// Full MongoDB connection string.
    /// Standalone:   mongodb://localhost:27017
    /// With auth:    mongodb://user:pass@host:27017/?authSource=admin
    /// Replica set:  mongodb://h1,h2,h3/?replicaSet=myRS
    /// Atlas/SRV:    mongodb+srv://user:pass@cluster.mongodb.net/
    /// With TLS:     mongodb://host:27017/?tls=true
    pub mongodb_uri: String,

    /// Default database shown on startup.
    pub mongodb_db: String,

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
        envy::from_env::<Config>()
    }

    pub fn jwks_url(&self) -> String {
        format!(
            "{}/realms/{}/protocol/openid-connect/certs",
            self.keycloak_url, self.keycloak_realm
        )
    }
}
