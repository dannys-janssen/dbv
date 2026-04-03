use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default = "default_host")]
    pub server_host: String,

    #[serde(default = "default_port")]
    pub server_port: u16,

    pub mongodb_uri: String,
    pub mongodb_db: String,

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
